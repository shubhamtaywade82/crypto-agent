import { CoinDCXClient } from '@nemesis-oss/coindcx-sdk';
import type { OllamaClient } from '@nemesis-oss/ollama-sdk';
import type { IExecutionBroker } from './infrastructure/broker/broker.js';
import { BinanceMarketDataProvider } from './infrastructure/binance/market-data-provider.js';
import { CoinDCXExecutionBroker } from './infrastructure/coindcx/execution-broker.js';
import { ContractRegistry } from './infrastructure/coindcx/contract-registry.js';
import { SymbolRouter } from './infrastructure/coindcx/symbol-router.js';
import { PaperExecutionBroker } from './infrastructure/paper/paper-broker-adapter.js';
import { EventStore } from './infrastructure/events/event-store.js';
import { createLogger, type Logger } from './infrastructure/observability/logger.js';
import { loadRiskLimits, type RiskLimits } from './domain/risk/risk-config.js';
import { FALLBACK_SPEC, type ContractSpec } from './domain/futures/contract-spec.js';
import { PortfolioEngine } from './engines/portfolio-engine.js';
import { PerformanceEngine } from './engines/performance-engine.js';
import { ExecutionEngine } from './engines/execution-engine.js';
import { Reconciler } from './engines/reconciler.js';
import { RiskReservationManager } from './engines/risk-reservations.js';
import { SymbolLanes } from './engines/event-bus.js';
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
  runPipeline(symbol: string): Promise<PipelineTrace>;
  assess(proposal: TradeProposal, state: MarketState): Promise<AssessResult>;
  executeProposal(proposal: TradeProposal, sizing: SizingResult, risk: RiskDecision): Promise<TrackedOrder>;
}

/** Slippage tolerance applied to entry execution (basis points). */
const maxSlippageBps = (): number => Number(process.env.MAX_SLIPPAGE_BPS ?? 25);

const buildCoinDCXStack = (
  log: Logger
): { broker: IExecutionBroker; router: SymbolRouter; registry: ContractRegistry } => {
  const client = new CoinDCXClient({
    apiKey: process.env.COINDCX_API_KEY,
    apiSecret: process.env.COINDCX_API_SECRET,
  });
  const router = new SymbolRouter(
    client,
    (process.env.COINDCX_QUOTE_PREFERENCE as 'USDT' | 'INR' | 'auto') ?? 'auto'
  );
  const registry = new ContractRegistry({
    ttlMs: Number(process.env.CONTRACT_TTL_MS ?? 5 * 60_000),
    maxStaleMs: Number(process.env.CONTRACT_MAX_STALE_MS ?? 30 * 60_000),
  });
  log.info('execution venue: coindcx');
  return {
    broker: new CoinDCXExecutionBroker(client, {
      maxOrderNotional: Number(process.env.MAX_POSITION_NOTIONAL_USDT ?? 5000),
      fxProvider: () => router.usdtInr(),
    }),
    router,
    registry,
  };
};

const buildBroker = (
  venue: ExecutionVenue,
  log: Logger,
  performance: PerformanceEngine
): { broker: IExecutionBroker; router?: SymbolRouter; registry?: ContractRegistry } => {
  if (venue === 'coindcx') return buildCoinDCXStack(log);
  log.info('execution venue: paper');
  return {
    broker: new PaperExecutionBroker({
      initialBalance: Number(process.env.PAPER_INITIAL_FUTURES_BALANCE ?? 10_000),
      // Realized closes feed the PerformanceEngine (daily PnL, streaks).
      onClose: (c) => performance.recordTradeClosed(c.pnl, c.at),
    }),
  };
};

const resolvePair = async (
  broker: IExecutionBroker,
  router: SymbolRouter | undefined,
  symbol: string
): Promise<string> => {
  if (broker.id === 'coindcx' && router) return (await router.resolve(symbol)).pair;
  return `B-${symbol.replace(/USDT$/, '')}_USDT`;
};

const registerAndSubmit = (
  execution: ExecutionEngine,
  args: {
    readonly pair: string;
    readonly proposal: TradeProposal;
    readonly sizing: SizingResult;
    readonly risk: RiskDecision;
  }
): Promise<TrackedOrder> => {
  const { pair, proposal, sizing, risk } = args;
  const side = proposal.direction === 'LONG' ? 'buy' : 'sell';
  execution.registerApproved({
    intentId: risk.decisionId, pair, symbol: proposal.symbol,
    side, quantity: sizing.quantity,
  });
  return execution.submit(risk.decisionId, {
    pair, side, orderType: 'market_order',
    quantity: sizing.quantity, leverage: sizing.leverage,
    marginType: 'isolated',
    stopLoss: proposal.stopLoss, takeProfit: proposal.takeProfit,
    // Execution-quality contract: never allow an unbounded fill.
    expectedPrice: proposal.entry,
    maxSlippageBps: maxSlippageBps(),
    // Audit lineage.
    strategyId: proposal.setupType,
    decisionId: risk.decisionId,
    intentType: 'ENTRY',
  });
};

const buildExecutor = (
  broker: IExecutionBroker,
  router: SymbolRouter | undefined,
  execution: ExecutionEngine
) => {
  return async (
    proposal: TradeProposal,
    sizing: SizingResult,
    risk: RiskDecision,
    _reservationId?: string
  ): Promise<TrackedOrder> => {
    const pair = await resolvePair(broker, router, proposal.symbol);
    if (broker instanceof PaperExecutionBroker) broker.setMarkPrice(pair, proposal.entry);
    return registerAndSubmit(execution, { pair, proposal, sizing, risk });
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
}

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

const buildParts = (ctx: KernelContext): KernelParts => {
  const limits = loadRiskLimits();
  const execution = new ExecutionEngine(ctx.broker, ctx.store);
  return {
    provider: new BinanceMarketDataProvider(binanceClient),
    limits,
    store: ctx.store,
    challengesEnabled: process.env.RISK_CHALLENGER_ENABLED !== 'false',
    execution,
    reservations: new RiskReservationManager(ctx.store),
    specFor: buildSpecFor(ctx),
    portfolio: new PortfolioEngine({
      broker: ctx.broker,
      limits,
      fallbackEquity: Number(process.env.PAPER_INITIAL_FUTURES_BALANCE ?? 10_000),
      performance: ctx.performance,
      usdtInrRate: ctx.router
        ? (): Promise<number> => ctx.router!.usdtInr()
        : undefined,
    }),
  };
};

export const createKernel = (venueOverride?: ExecutionVenue): TradingKernel => {
  const log = createLogger('kernel');
  const venue: ExecutionVenue =
    venueOverride ?? (process.env.EXECUTION_VENUE as ExecutionVenue | undefined) ?? 'paper';
  const store = new EventStore({ durable: venue === 'coindcx' });

  // Performance ledger first: the paper broker closes feed it, the
  // portfolio engine reads it, restarts hydrate from the event store.
  const performance = new PerformanceEngine(store);
  performance.hydrate();

  const { broker, router, registry } = buildBroker(venue, log, performance);
  const ctx: KernelContext = { venue, store, broker, router, registry, performance };
  const parts = buildParts(ctx);
  const reconciler = new Reconciler(broker, parts.execution, parts.store);
  const deps = buildPipelineDeps(parts, ollamaClient, router, broker);
  const assess = (proposal: TradeProposal, state: MarketState): Promise<AssessResult> =>
    assessProposal(deps, proposal, state);
  const executor = deps.execute as NonNullable<typeof deps.execute>;

  return {
    venue, provider: parts.provider, broker, router, limits: parts.limits,
    portfolio: parts.portfolio, performance, reservations: parts.reservations, registry,
    execution: parts.execution, reconciler,
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
