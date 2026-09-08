import { FALLBACK_SPEC, type ContractSpec } from './domain/futures/contract-spec.js';
import { loadRiskLimits, type RiskLimits } from './domain/risk/risk-config.js';
import { PortfolioEngine } from './engines/portfolio-engine.js';
import type { PerformanceEngine } from './engines/performance-engine.js';
import type { PortfolioStateStore } from './engines/portfolio-state-store.js';
import type { StrategyRegistry } from './learning/strategy-registry.js';
import type { ContractRegistry } from './infrastructure/coindcx/contract-registry.js';
import type { IExecutionBroker } from './infrastructure/broker/broker.js';
import type { SymbolRouter } from './infrastructure/coindcx/symbol-router.js';
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
