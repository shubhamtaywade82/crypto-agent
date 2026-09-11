import type { OllamaClient } from '@nemesis-oss/ollama-sdk';
import { analyzeMarket } from './agents/analyst-agent.js';
import { strategize } from './agents/strategist-agent.js';
import { challengeProposal } from './agents/risk-challenger.js';
import { defaultModel } from './config.js';
import { FALLBACK_SPEC, type ContractSpec } from './domain/futures/contract-spec.js';
import type { MarketState } from './domain/market/types.js';
import { loadRiskLimits, type RiskLimits } from './domain/risk/risk-config.js';
import type { TradeProposal } from './domain/orders/trade-proposal.js';
import type { MarketAnalysis, StrategyOutcome, ChallengerVerdict } from './agents/schemas.js';
import { PortfolioEngine } from './engines/portfolio-engine.js';
import type { ExecutionEngine } from './engines/execution-engine.js';
import type { PerformanceEngine } from './engines/performance-engine.js';
import type { PortfolioStateStore } from './engines/portfolio-state-store.js';
import type { MarketStateStore } from './engines/market-state-store.js';
import type { PipelineDeps, StrategyRequest } from './engines/pipeline.js';
import { evidenceEnabled, getMiEvidenceCache } from './engines/mi-evidence-cache.js';
import { evidenceGateEnabled, verdictForSetup } from './engines/mi-evidence-gate.js';
import type { StrategyRegistry } from './learning/strategy-registry.js';
import type { TradeLedger, TradeFeatureSnapshot } from './learning/trade-ledger.js';
import type { ContractRegistry } from './infrastructure/coindcx/contract-registry.js';
import type { IExecutionBroker } from './infrastructure/broker/broker.js';
import { BinanceMarketDataProvider } from './infrastructure/binance/market-data-provider.js';
import type { SymbolRouter } from './infrastructure/coindcx/symbol-router.js';
import type { EventStore } from './infrastructure/events/event-store.js';
import type { RiskReservationManager } from './engines/risk-reservations.js';
import type { KillSwitch } from './security/kill-switch.js';
import { buildExecutor } from './kernel-executor.js';
import type { ExecutionVenue } from './kernel.js';

/**
 * Composition helpers shared by the kernel assembly (kept out of
 * kernel.ts to honor the repo's file-size cap; behavior identical).
 */

/** REAL venue specs for live; the paper simulator publishes its own constraints. */
export const buildSpecFor = (parts: {
  readonly venue: ExecutionVenue;
  readonly broker: IExecutionBroker;
  readonly router?: SymbolRouter;
  readonly registry?: ContractRegistry;
}): ((symbol: string) => Promise<ContractSpec>) => {
  const { venue, broker, router, registry } = parts;
  return async (symbol: string): Promise<ContractSpec> => {
    if (venue === 'coindcx' && router && registry) {
      const pair = await router.resolve(symbol).then((r) => r.pair);
      return registry.require(broker, pair);
    }
    return FALLBACK_SPEC(symbol.replace(/USDT$/, ''));
  };
};

export interface PortfolioParts {
  readonly broker: IExecutionBroker;
  readonly router?: SymbolRouter;
  readonly performance: PerformanceEngine;
  readonly accountCache: PortfolioStateStore;
}

export const buildPortfolio = (parts: PortfolioParts, limits: RiskLimits): PortfolioEngine =>
  new PortfolioEngine({
    broker: parts.broker,
    limits,
    fallbackEquity: Number(process.env.PAPER_INITIAL_FUTURES_BALANCE ?? 10_000),
    performance: parts.performance,
    cache: parts.accountCache,
    cacheMaxAgeMs: Number(process.env.PORTFOLIO_CACHE_MAX_AGE_MS ?? 10_000),
    usdtInrRate: parts.router
      ? (): Promise<number> => parts.router!.usdtInr()
      : undefined,
  });

/**
 * Strategy-cell gate factory (V3.1 P0-5): ACTIVE strategy + approved
 * cell = tradable. Bootstrap policy: with ZERO registered strategies the
 * kernel cannot know which cells the research gate trusts, so trading
 * runs open — every deployment is expected to register + promote
 * strategies before scaling, after which the gate is strict.
 */
export const buildStrategyGate = (
  strategies: StrategyRegistry
): ((
  strategyId: string, setupType: string, regime: string
) => { readonly allowed: boolean; readonly reason?: string }) =>
  (strategyId, setupType, regime): { readonly allowed: boolean; readonly reason?: string } => {
    if (strategies.all().length === 0) return { allowed: true };
    return strategies.isCellTradable(strategyId, setupType, regime);
  };

export const loadLimits = (): RiskLimits => loadRiskLimits();

export interface PipelineParts {
  readonly provider: BinanceMarketDataProvider;
  readonly limits: RiskLimits;
  readonly portfolio: PortfolioEngine;
  readonly execution: ExecutionEngine;
  readonly store: EventStore;
  readonly challengesEnabled: boolean;
  readonly specFor: (symbol: string) => Promise<ContractSpec>;
  readonly reservations: RiskReservationManager;
  readonly killSwitch: KillSwitch;
  readonly ledger: TradeLedger;
  readonly strategies: StrategyRegistry;
  readonly marketStore: MarketStateStore;
  readonly crossVenueGate?: (symbol: string) => Promise<{
    readonly tradable: boolean;
    readonly reasons: readonly string[];
  }>;
  readonly registerPendingSnapshot?: (snapshot: TradeFeatureSnapshot) => void;
}

const buildAnalyze = (ollama: OllamaClient) =>
  (state: MarketState, evidence?: string): Promise<MarketAnalysis> =>
    analyzeMarket(ollama, defaultModel, state, evidence);

const gateCheck = (kill: KillSwitch): (() => { readonly allowed: boolean; readonly reason?: string }) =>
  (): { readonly allowed: boolean; readonly reason?: string } =>
    kill.halted ? { allowed: false, reason: `kill switch HALTED: ${kill.currentReason}` } : { allowed: true };

const defaultEvidence = (parts: PipelineParts): PipelineDeps['getEvidence'] =>
  evidenceEnabled()
    ? (symbol: string): Promise<string | undefined> => getMiEvidenceCache().blockFor(
      { provider: parts.provider, marketStore: parts.marketStore }, symbol, ['liquidity_sweep', 'choch', 'bos']
    )
    : undefined;

const buildEvidenceGate = (parts: PipelineParts): PipelineDeps['evidenceGate'] => {
  if (!evidenceGateEnabled()) return undefined;
  const deps = { provider: parts.provider, marketStore: parts.marketStore };
  return async (symbol: string, setupType: string) => {
    const snap = await getMiEvidenceCache().getOrRefresh(deps, symbol);
    const verdict = verdictForSetup(snap, setupType);
    return { allowed: verdict.allowed, reason: verdict.reason };
  };
};

export const buildPipelineDeps = (
  parts: PipelineParts,
  ollama: OllamaClient,
  router: SymbolRouter | undefined,
  broker: IExecutionBroker
): PipelineDeps => ({
  provider: parts.provider, limits: parts.limits, portfolio: parts.portfolio,
  execution: parts.execution, store: parts.store, challengesEnabled: parts.challengesEnabled,
  specFor: parts.specFor, reservations: parts.reservations, isTradingAllowed: gateCheck(parts.killSwitch),
  ledger: parts.ledger, marketStore: parts.marketStore,
  marketMaxStaleMs: Number(process.env.MARKET_MAX_STALE_MS ?? 45_000),
  crossVenueGate: parts.crossVenueGate, strategyGate: buildStrategyGate(parts.strategies),
  analyze: buildAnalyze(ollama),
  strategize: (r: StrategyRequest): Promise<StrategyOutcome> => strategize(ollama, defaultModel, r),
  challenge: (p: TradeProposal, s: MarketState): Promise<ChallengerVerdict> =>
    challengeProposal(ollama, defaultModel, p, s),
  execute: buildExecutor(broker, router, parts.execution),
  getEvidence: defaultEvidence(parts), evidenceGate: buildEvidenceGate(parts),
  registerPendingSnapshot: parts.registerPendingSnapshot,
});
