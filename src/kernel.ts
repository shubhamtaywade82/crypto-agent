import { CoinDCXClient } from '@nemesis-oss/coindcx-sdk';
import type { IExecutionBroker } from './infrastructure/broker/broker.js';
import { BinanceMarketDataProvider } from './infrastructure/binance/market-data-provider.js';
import { buildBroker, recordLiveClose, type ExecutionVenue } from './kernel-venue.js';
import { buildSpecFor, buildPortfolio, buildPipelineDeps, buildStrategyGate } from './kernel-builders.js';
import { SymbolRouter } from './infrastructure/coindcx/symbol-router.js';
import { EventStore } from './infrastructure/events/event-store.js';
import { createLogger, type Logger } from './infrastructure/observability/logger.js';
import { loadRiskLimits, type RiskLimits } from './domain/risk/risk-config.js';
import type { ContractSpec } from './domain/futures/contract-spec.js';
import type { ContractRegistry } from './infrastructure/coindcx/contract-registry.js';
import { PortfolioEngine } from './engines/portfolio-engine.js';
import { PerformanceEngine } from './engines/performance-engine.js';
import { ExecutionEngine } from './engines/execution-engine.js';
import { Reconciler } from './engines/reconciler.js';
import { RiskReservationManager } from './engines/risk-reservations.js';
import { FillsLedger } from './engines/fills-ledger.js';
import { SymbolLanes } from './engines/event-bus.js';
import { KillSwitch } from './security/kill-switch.js';
import { TradeLedger, type TradeFeatureSnapshot } from './learning/trade-ledger.js';
import { StrategyRegistry } from './learning/strategy-registry.js';
import { buildStreams, startStreams, stopStreams, type KernelStreams } from './kernel-streams.js';
import { runTradingPipeline, type PipelineTrace } from './engines/pipeline.js';
import type { TradeProposal, ValidationResult } from './domain/orders/trade-proposal.js';
import type { SizingResult } from './engines/position-sizer.js';
import type { RiskDecision } from './domain/risk/risk-decision.js';
import type { TrackedOrder } from './engines/execution-engine.js';
import { assessProposal } from './engines/pipeline.js';
import type { MarketState } from './domain/market/types.js';
import { MarketStateStore } from './engines/market-state-store.js';
import { PortfolioStateStore } from './engines/portfolio-state-store.js';
import { binanceClient, ollamaClient } from './config.js';
import { PolicyGateway } from './engines/policy-gateway.js';

export type { ExecutionVenue } from './kernel-venue.js';

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
  readonly gateway: PolicyGateway;
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
  readonly strategies: StrategyRegistry;
  readonly marketStore: MarketStateStore;
  readonly fills: FillsLedger;
  readonly streams: KernelStreams;
  readonly registerPendingSnapshot: (snapshot: TradeFeatureSnapshot) => void;
  readonly clearPendingSnapshot: (decisionId: string) => void;
  readonly commitPendingSnapshot: (decisionId: string) => void;
  readonly crossVenueGate?: (symbol: string) => Promise<{
    readonly tradable: boolean;
    readonly reasons: readonly string[];
  }>;
}

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
  const performance = new PerformanceEngine(store);
  performance.hydrate();
  const ledger = new TradeLedger(store);
  ledger.hydrate();
  const strategies = new StrategyRegistry(store);
  strategies.hydrate();
  // Event-driven stores exist BEFORE the venue stack: the cross-venue
  // gate reads real Binance book-ticker quotes from the market store.
  const marketStore = new MarketStateStore();
  const { client, broker, router, registry, crossVenueGate } =
    buildBroker({ venue, log, performance, ledger, marketStore });
  const fills = new FillsLedger(
    store, venue,
    venue === 'coindcx'
      ? (a): void => recordLiveClose(performance, ledger, a)
      : undefined
  );
  fills.hydrate();
  return {
    venue, store, broker, router, registry, performance, ledger, strategies, crossVenueGate,
    coindcxClient: client, marketStore,
    accountCache: new PortfolioStateStore(),
    fills,
  };
};

/** Fail-safe hydrate + defense-in-depth submission gate. */
const installSafetyGates = (
  parts: KernelParts,
  pendingSnapshots: Map<string, TradeFeatureSnapshot>
): void => {
  // Restart truth: rebuild tracked orders (incl. UNKNOWN) from the event
  // log so the reconciler converges instead of forgetting live orders.
  parts.execution.hydrate();
  // Confirmed-fill-based learning: persist trade.opened on first fill delta.
  parts.execution.setFillHook((tracked, at): void => {
    parts.fills.record(tracked, at);
    if (tracked.intentType === 'ENTRY' && tracked.filledQuantity > 0) {
      const snap = pendingSnapshots.get(tracked.intentId);
      if (snap) {
        parts.ledger.recordOpened(snap);
        pendingSnapshots.delete(tracked.intentId);
      }
    }
  });
  // Unknown/unreadable state stays HALTED (fail-safe default).
  parts.killSwitch.hydrate();
  // The execution engine independently refuses new submissions while
  // the durable kill switch is engaged.
  parts.execution.setSubmissionGate((): string | null =>
    parts.killSwitch.halted ? `kill switch HALTED: ${parts.killSwitch.currentReason}` : null
  );
};

const buildResyncAccount = (ctx: KernelContext) => async (): Promise<void> => {
  const [positions, balances] = await Promise.all([
    ctx.broker.getPositions(), ctx.broker.getBalances(),
  ]);
  ctx.accountCache.syncSnapshot(positions, balances, Date.now());
};

interface SnapshotHooks {
  readonly registerPendingSnapshot: (snapshot: TradeFeatureSnapshot) => void;
  readonly clearPendingSnapshot: (decisionId: string) => void;
  readonly commitPendingSnapshot: (decisionId: string) => void;
}

const buildSnapshotHooks = (
  ledger: TradeLedger,
  pending: Map<string, TradeFeatureSnapshot>
): SnapshotHooks => ({
  registerPendingSnapshot: (s) => pending.set(s.decisionId, s),
  clearPendingSnapshot: (id) => pending.delete(id),
  commitPendingSnapshot: (id): void => {
    const snap = pending.get(id);
    if (!snap) return;
    ledger.recordOpened(snap);
    pending.delete(id);
  },
});

const buildParts = (ctx: KernelContext, log: Logger, hooks: SnapshotHooks): KernelParts => {
  const limits = loadRiskLimits();
  const provider = new BinanceMarketDataProvider(binanceClient);
  return {
    killSwitch: new KillSwitch(ctx.store),
    ledger: ctx.ledger,
    strategies: ctx.strategies,
    provider,
    limits,
    store: ctx.store,
    challengesEnabled: process.env.RISK_CHALLENGER_ENABLED !== 'false',
    execution: new ExecutionEngine(ctx.broker, ctx.store),
    reservations: new RiskReservationManager(ctx.store),
    specFor: buildSpecFor(ctx),
    marketStore: ctx.marketStore,
    fills: ctx.fills,
    registerPendingSnapshot: hooks.registerPendingSnapshot,
    clearPendingSnapshot: hooks.clearPendingSnapshot,
    commitPendingSnapshot: hooks.commitPendingSnapshot,
    streams: buildStreams({
      audit: ctx.store, provider, log, venue: ctx.venue,
      marketStore: ctx.marketStore, accountCache: ctx.accountCache,
      coindcxClient: ctx.coindcxClient, resyncAccount: buildResyncAccount(ctx),
    }),
    portfolio: buildPortfolio({
      broker: ctx.broker, router: ctx.router,
      performance: ctx.performance, accountCache: ctx.accountCache,
    }, limits),
  };
};

const buildGateway = (parts: KernelParts): PolicyGateway =>
  new PolicyGateway({
    limits: parts.limits,
    portfolio: parts.portfolio,
    execution: parts.execution,
    reservations: parts.reservations,
    specFor: parts.specFor,
    store: parts.store,
    isTradingAllowed: (): { readonly allowed: boolean; readonly reason?: string } =>
      parts.killSwitch.halted
        ? { allowed: false, reason: `kill switch HALTED: ${parts.killSwitch.currentReason}` }
        : { allowed: true },
    crossVenueGate: parts.crossVenueGate,
    strategyGate: buildStrategyGate(parts.strategies),
    registerPendingSnapshot: parts.registerPendingSnapshot,
  });

export const createKernel = (venueOverride?: ExecutionVenue): TradingKernel => {
  const log = createLogger('kernel');
  const venue: ExecutionVenue =
    venueOverride ?? (process.env.EXECUTION_VENUE as ExecutionVenue | undefined) ?? 'paper';
  const store = new EventStore({ durable: venue === 'coindcx' });
  const pendingSnapshots = new Map<string, TradeFeatureSnapshot>();

  const ctx = buildKernelContext(venue, store, log);
  const parts = buildParts(ctx, log, buildSnapshotHooks(ctx.ledger, pendingSnapshots));
  installSafetyGates(parts, pendingSnapshots);
  const reconciler = new Reconciler(ctx.broker, parts.execution, parts.store, parts.reservations);
  const deps = buildPipelineDeps(parts, ollamaClient, ctx.router, ctx.broker);
  const assess = (proposal: TradeProposal, state: MarketState): Promise<AssessResult> =>
    assessProposal(deps, proposal, state);
  const executor = deps.execute as NonNullable<typeof deps.execute>;
  const gateway = buildGateway(parts);

  return {
    venue, provider: parts.provider, broker: ctx.broker, router: ctx.router,
    limits: parts.limits,
    portfolio: parts.portfolio, performance: ctx.performance,
    reservations: parts.reservations, registry: ctx.registry,
    execution: parts.execution, reconciler, gateway, killSwitch: parts.killSwitch,
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
