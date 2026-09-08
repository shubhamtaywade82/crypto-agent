import { CoinDCXClient } from '@nemesis-oss/coindcx-sdk';
import type { OllamaClient } from '@nemesis-oss/ollama-sdk';
import type { IExecutionBroker } from './infrastructure/broker/broker.js';
import { BinanceMarketDataProvider } from './infrastructure/binance/market-data-provider.js';
import { buildCoinDCXStack } from './kernel-venue.js';
import { SymbolRouter } from './infrastructure/coindcx/symbol-router.js';
import { PaperExecutionBroker } from './infrastructure/paper/paper-broker-adapter.js';
import { EventStore } from './infrastructure/events/event-store.js';
import { createLogger, type Logger } from './infrastructure/observability/logger.js';
import { loadRiskLimits, type RiskLimits } from './domain/risk/risk-config.js';
import { FALLBACK_SPEC, type ContractSpec } from './domain/futures/contract-spec.js';
import type { ContractRegistry } from './infrastructure/coindcx/contract-registry.js';
import { PortfolioEngine } from './engines/portfolio-engine.js';
import { PerformanceEngine } from './engines/performance-engine.js';
import { ExecutionEngine } from './engines/execution-engine.js';
import { Reconciler } from './engines/reconciler.js';
import { RiskReservationManager } from './engines/risk-reservations.js';
import { FillsLedger } from './engines/fills-ledger.js';
import { SymbolLanes } from './engines/event-bus.js';
import { KillSwitch } from './security/kill-switch.js';
import { TradeLedger } from './learning/trade-ledger.js';
import { StrategyRegistry } from './learning/strategy-registry.js';
import { buildExecutor } from './kernel-executor.js';
import { buildStreams, startStreams, stopStreams, type KernelStreams } from './kernel-streams.js';
import { runTradingPipeline, type PipelineTrace, type PipelineDeps, type StrategyRequest } from './engines/pipeline.js';
import { analyzeMarket } from './agents/analyst-agent.js';
import { strategize } from './agents/strategist-agent.js';
import { challengeProposal } from './agents/risk-challenger.js';
import type { MarketAnalysis, StrategyOutcome, ChallengerVerdict } from './agents/schemas.js';
import type { TradeProposal, ValidationResult } from './domain/orders/trade-proposal.js';
import type { SizingResult } from './engines/position-sizer.js';
import type { RiskDecision } from './domain/risk/risk-decision.js';
import type { TrackedOrder } from './engines/execution-engine.js';
import { assessProposal } from './engines/pipeline.js';
import type { MarketState } from './domain/market/types.js';
import { MarketStateStore } from './engines/market-state-store.js';
import { PortfolioStateStore } from './engines/portfolio-state-store.js';
import { binanceClient, defaultModel, ollamaClient } from './config.js';

export type ExecutionVenue = 'paper' | 'coindcx';

export interface AssessResult {
  readonly validation: ValidationResult;
  readonly sizing: SizingResult;
  readonly risk: RiskDecision;
}

export interface TradingKernel {
  readonly venue: ExecutionVenue;
  readonly provider: BinanceMarketDataProvider;
  readonly broker: IExecutionBroker;
  readonly router?: SymbolRouter;
  readonly limits: RiskLimits;
  readonly portfolio: PortfolioEngine;
  readonly performance: PerformanceEngine;
  readonly reservations: RiskReservationManager;
  readonly registry?: ContractRegistry;
  readonly execution: ExecutionEngine;
  readonly reconciler: Reconciler;
  readonly lanes: SymbolLanes;
  readonly store: EventStore;
  readonly log: Logger;
  /** Durable global trading gate: pipeline + submission refuse while halted. */
  readonly killSwitch: KillSwitch;
  /** Learning ledger: feature snapshots + attributed outcomes. */
  readonly ledger: TradeLedger;
  /** Strategy registry with pre-registered promotion gates. */
  readonly strategies: StrategyRegistry;
  /** Event-driven runtime stores (WS-fed, REST-recovered). */
  readonly marketStore: MarketStateStore;
  readonly accountCache: PortfolioStateStore;
  readonly streams: KernelStreams;
  /** Live fills ledger: execution quality + live PnL attribution. */
  readonly fills: FillsLedger;
  /** Boot the WS streams (idempotent); REST-only when disabled. */
  startStreams(): Promise<void>;
  stopStreams(): void;
  runPipeline(symbol: string): Promise<PipelineTrace>;
  assess(proposal: TradeProposal, state: MarketState): Promise<AssessResult>;
  executeProposal(proposal: TradeProposal, sizing: SizingResult, risk: RiskDecision): Promise<TrackedOrder>;
}

/** Live venue selection: CoinDCX stack, or the paper simulator. */
const buildBroker = (
  venue: ExecutionVenue,
  log: Logger,
  performance: PerformanceEngine,
  ledger: TradeLedger
): {
  client?: CoinDCXClient;
  broker: IExecutionBroker;
  router?: SymbolRouter;
  registry?: ContractRegistry;
  crossVenueGate?: (symbol: string) => Promise<{ readonly tradable: boolean; readonly reasons: readonly string[] }>;
} => {
  if (venue === 'coindcx') return buildCoinDCXStack(log);
  log.info('execution venue: paper');
  return {
    broker: new PaperExecutionBroker({
      initialBalance: Number(process.env.PAPER_INITIAL_FUTURES_BALANCE ?? 10_000),
      // Realized closes feed the PerformanceEngine (daily PnL, streaks)
      // and the learning ledger (outcome attribution by decisionId).
      onClose: (c): void => {
        performance.recordTradeClosed(c.pnl, c.at);
        if (c.decisionId) ledger.recordClosed(c.decisionId, c.pnl, c.at);
      },
    }),
  };
};

interface KernelParts {
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
  readonly marketStore: MarketStateStore;
  readonly fills: FillsLedger;
  readonly streams: KernelStreams;
  readonly crossVenueGate?: (symbol: string) => Promise<{
    readonly tradable: boolean;
    readonly reasons: readonly string[];
  }>;
}

const buildPipelineDeps = (
  parts: KernelParts,
  ollama: OllamaClient,
  router: SymbolRouter | undefined,
  broker: IExecutionBroker
): PipelineDeps => {
  const analyze = (state: MarketState): Promise<MarketAnalysis> =>
    analyzeMarket(ollama, defaultModel, state);
  const strategizeFn = (request: StrategyRequest): Promise<StrategyOutcome> =>
    strategize(ollama, defaultModel, request);
  const challenge = (proposal: TradeProposal, state: MarketState): Promise<ChallengerVerdict> =>
    challengeProposal(ollama, defaultModel, proposal, state);
  return {
    provider: parts.provider,
    limits: parts.limits,
    portfolio: parts.portfolio,
    execution: parts.execution,
    store: parts.store,
    challengesEnabled: parts.challengesEnabled,
    specFor: parts.specFor,
    reservations: parts.reservations,
    isTradingAllowed: (): { readonly allowed: boolean; readonly reason?: string } =>
      parts.killSwitch.halted
        ? { allowed: false, reason: `kill switch HALTED: ${parts.killSwitch.currentReason}` }
        : { allowed: true },
    ledger: parts.ledger,
    marketStore: parts.marketStore,
    marketMaxStaleMs: Number(process.env.MARKET_MAX_STALE_MS ?? 45_000),
    crossVenueGate: parts.crossVenueGate,
    analyze,
    strategize: strategizeFn,
    challenge,
    execute: buildExecutor(broker, router, parts.execution),
  };
};

interface KernelContext {
  readonly venue: ExecutionVenue;
  readonly store: EventStore;
  readonly broker: IExecutionBroker;
  readonly router?: SymbolRouter;
  readonly registry?: ContractRegistry;
  readonly performance: PerformanceEngine;
  readonly ledger: TradeLedger;
  readonly strategies: StrategyRegistry;
  readonly coindcxClient?: CoinDCXClient;
  readonly marketStore: MarketStateStore;
  readonly accountCache: PortfolioStateStore;
  readonly fills: FillsLedger;
  readonly crossVenueGate?: (symbol: string) => Promise<{
    readonly tradable: boolean;
    readonly reasons: readonly string[];
  }>;
}

/** Construct + hydrate the durable state layers, then pick the venue. */
const buildKernelContext = (
  venue: ExecutionVenue,
  store: EventStore,
  log: Logger
): KernelContext => {
  // Performance ledger: closes feed it, portfolio reads it, restarts
  // hydrate from the event store.
  const performance = new PerformanceEngine(store);
  performance.hydrate();
  // Learning layer: trade ledger + strategy registry replay the log too.
  const ledger = new TradeLedger(store);
  ledger.hydrate();
  const strategies = new StrategyRegistry(store);
  strategies.hydrate();
  const { client, broker, router, registry, crossVenueGate } = buildBroker(venue, log, performance, ledger);
  // Live fills ledger. On the LIVE venue, fills-realized closes feed the
  // performance engine and the learning ledger (paper feeds them through
  // its own onClose hook — wiring both would double-count).
  const fills = new FillsLedger(
    store, venue,
    venue === 'coindcx'
      ? (decisionId, pnl, at): void => {
          performance.recordTradeClosed(pnl, at);
          ledger.recordClosed(decisionId, pnl, at);
        }
      : undefined
  );
  fills.hydrate();
  return {
    venue, store, broker, router, registry, performance, ledger, strategies, crossVenueGate,
    coindcxClient: client,
    marketStore: new MarketStateStore(),
    accountCache: new PortfolioStateStore(),
    fills,
  };
};

/** Fail-safe hydrate + defense-in-depth submission gate. */
const installSafetyGates = (parts: KernelParts): void => {
  // Restart truth: rebuild tracked orders (incl. UNKNOWN) from the event
  // log so the reconciler converges instead of forgetting live orders.
  parts.execution.hydrate();
  // Execution quality + live PnL attribution: every fill delta flows
  // through the ledger (submit path AND reconciler fold).
  parts.execution.setFillHook((tracked, at): void => {
    parts.fills.record(tracked, at);
  });
  // Unknown/unreadable state stays HALTED (fail-safe default).
  parts.killSwitch.hydrate();
  // The execution engine independently refuses new submissions while
  // the durable kill switch is engaged.
  parts.execution.setSubmissionGate((): string | null =>
    parts.killSwitch.halted ? `kill switch HALTED: ${parts.killSwitch.currentReason}` : null
  );
};

/** REAL venue specs for live; the paper simulator publishes its own constraints. */
const buildSpecFor = (
  ctx: KernelContext
): ((symbol: string) => Promise<ContractSpec>) => {
  const { venue, broker, router, registry } = ctx;
  return async (symbol: string): Promise<ContractSpec> => {
    if (venue === 'coindcx' && router && registry) {
      const pair = await router.resolve(symbol).then((r) => r.pair);
      return registry.require(broker, pair);
    }
    return FALLBACK_SPEC(symbol.replace(/USDT$/, ''));
  };
};

const buildPortfolio = (ctx: KernelContext, limits: RiskLimits): PortfolioEngine =>
  new PortfolioEngine({
    broker: ctx.broker,
    limits,
    fallbackEquity: Number(process.env.PAPER_INITIAL_FUTURES_BALANCE ?? 10_000),
    performance: ctx.performance,
    cache: ctx.accountCache,
    cacheMaxAgeMs: Number(process.env.PORTFOLIO_CACHE_MAX_AGE_MS ?? 10_000),
    usdtInrRate: ctx.router
      ? (): Promise<number> => ctx.router!.usdtInr()
      : undefined,
  });

const buildParts = (ctx: KernelContext, log: Logger): KernelParts => {
  const limits = loadRiskLimits();
  const provider = new BinanceMarketDataProvider(binanceClient);
  const resyncAccount = async (): Promise<void> => {
    const [positions, balances] = await Promise.all([
      ctx.broker.getPositions(), ctx.broker.getBalances(),
    ]);
    ctx.accountCache.syncSnapshot(positions, balances, Date.now());
  };
  return {
    killSwitch: new KillSwitch(ctx.store),
    ledger: ctx.ledger,
    provider,
    limits,
    store: ctx.store,
    challengesEnabled: process.env.RISK_CHALLENGER_ENABLED !== 'false',
    execution: new ExecutionEngine(ctx.broker, ctx.store),
    reservations: new RiskReservationManager(ctx.store),
    specFor: buildSpecFor(ctx),
    marketStore: ctx.marketStore,
    fills: ctx.fills,
    streams: buildStreams({
      audit: ctx.store, provider, log, venue: ctx.venue,
      coindcxClient: ctx.coindcxClient, resyncAccount,
    }),
    portfolio: buildPortfolio(ctx, limits),
  };
};

export const createKernel = (venueOverride?: ExecutionVenue): TradingKernel => {
  const log = createLogger('kernel');
  const venue: ExecutionVenue =
    venueOverride ?? (process.env.EXECUTION_VENUE as ExecutionVenue | undefined) ?? 'paper';
  const store = new EventStore({ durable: venue === 'coindcx' });

  const ctx = buildKernelContext(venue, store, log);
  const parts = buildParts(ctx, log);
  installSafetyGates(parts);
  const reconciler = new Reconciler(ctx.broker, parts.execution, parts.store);
  const deps = buildPipelineDeps(parts, ollamaClient, ctx.router, ctx.broker);
  const assess = (proposal: TradeProposal, state: MarketState): Promise<AssessResult> =>
    assessProposal(deps, proposal, state);
  const executor = deps.execute as NonNullable<typeof deps.execute>;

  return {
    venue, provider: parts.provider, broker: ctx.broker, router: ctx.router,
    limits: parts.limits,
    portfolio: parts.portfolio, performance: ctx.performance,
    reservations: parts.reservations, registry: ctx.registry,
    execution: parts.execution, reconciler, killSwitch: parts.killSwitch,
    ledger: ctx.ledger, strategies: ctx.strategies,
    marketStore: parts.marketStore, accountCache: ctx.accountCache,
    fills: parts.fills,
    streams: parts.streams,
    startStreams: (): Promise<void> => startStreams(parts.streams, log),
    stopStreams: (): void => stopStreams(parts.streams),
    lanes: new SymbolLanes(), store: parts.store, log,
    runPipeline: (symbol: string): Promise<PipelineTrace> => runTradingPipeline(deps, symbol),
    assess,
    executeProposal: (
      proposal: TradeProposal, sizing: SizingResult, risk: RiskDecision
    ): Promise<TrackedOrder> => executor(proposal, sizing, risk),
  };
};

let singleton: TradingKernel | undefined;

export const getKernel = (): TradingKernel => {
  if (!singleton) singleton = createKernel();
  return singleton;
};
