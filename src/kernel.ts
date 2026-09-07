import { CoinDCXClient } from '@nemesis-oss/coindcx-sdk';
import type { OllamaClient } from '@nemesis-oss/ollama-sdk';
import type { IExecutionBroker } from './infrastructure/broker/broker.js';
import { BinanceMarketDataProvider } from './infrastructure/binance/market-data-provider.js';
import { CoinDCXExecutionBroker } from './infrastructure/coindcx/execution-broker.js';
import { SymbolRouter } from './infrastructure/coindcx/symbol-router.js';
import { PaperExecutionBroker } from './infrastructure/paper/paper-broker-adapter.js';
import { EventStore } from './infrastructure/events/event-store.js';
import { createLogger, type Logger } from './infrastructure/observability/logger.js';
import { loadRiskLimits, type RiskLimits } from './domain/risk/risk-config.js';
import { PortfolioEngine } from './engines/portfolio-engine.js';
import { ExecutionEngine } from './engines/execution-engine.js';
import { Reconciler } from './engines/reconciler.js';
import { SymbolLanes } from './engines/event-bus.js';
import { runTradingPipeline, type PipelineTrace, type PipelineDeps, type StrategyRequest } from './engines/pipeline.js';
import { analyzeMarket } from './agents/analyst-agent.js';
import { strategize } from './agents/strategist-agent.js';
import { challengeProposal } from './agents/risk-challenger.js';
import type { MarketAnalysis, StrategyOutcome, ChallengerVerdict } from './agents/schemas.js';
import type { TradeProposal } from './domain/orders/trade-proposal.js';
import type { SizingResult } from './engines/position-sizer.js';
import type { RiskDecision } from './domain/risk/risk-decision.js';
import type { TrackedOrder } from './engines/execution-engine.js';
import { assessProposal } from './engines/pipeline.js';
import type { MarketState } from './domain/market/types.js';
import { binanceClient, defaultModel, ollamaClient } from './config.js';

export type ExecutionVenue = 'paper' | 'coindcx';

export interface AssessResult {
  readonly validation: ReturnType<typeof assessProposal>['validation'];
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
  readonly execution: ExecutionEngine;
  readonly reconciler: Reconciler;
  readonly lanes: SymbolLanes;
  readonly store: EventStore;
  readonly log: Logger;
  runPipeline(symbol: string): Promise<PipelineTrace>;
  assess(proposal: TradeProposal, state: MarketState): AssessResult;
  executeProposal(proposal: TradeProposal, sizing: SizingResult, risk: RiskDecision): Promise<TrackedOrder>;
}

const buildBroker = (
  venue: ExecutionVenue,
  log: Logger
): { broker: IExecutionBroker; router?: SymbolRouter } => {
  if (venue === 'coindcx') {
    const client = new CoinDCXClient({
      apiKey: process.env.COINDCX_API_KEY,
      apiSecret: process.env.COINDCX_API_SECRET,
    });
    const router = new SymbolRouter(
      client,
      (process.env.COINDCX_QUOTE_PREFERENCE as 'USDT' | 'INR' | 'auto') ?? 'auto'
    );
    log.info('execution venue: coindcx');
    return {
      broker: new CoinDCXExecutionBroker(client, {
        maxOrderNotional: Number(process.env.MAX_POSITION_NOTIONAL_USDT ?? 5000),
        fxProvider: () => router.usdtInr(),
      }),
      router,
    };
  }
  log.info('execution venue: paper');
  return {
    broker: new PaperExecutionBroker({
      initialBalance: Number(process.env.PAPER_INITIAL_FUTURES_BALANCE ?? 10_000),
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
    risk: RiskDecision
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
    analyze,
    strategize: strategizeFn,
    challenge,
    execute: buildExecutor(broker, router, parts.execution),
  };
};

export const createKernel = (venueOverride?: ExecutionVenue): TradingKernel => {
  const log = createLogger('kernel');
  const venue: ExecutionVenue =
    venueOverride ?? (process.env.EXECUTION_VENUE as ExecutionVenue | undefined) ?? 'paper';
  const { broker, router } = buildBroker(venue, log);
  const store = new EventStore();
  const execution = new ExecutionEngine(broker, store);
  const limits = loadRiskLimits();
  const parts: KernelParts = {
    provider: new BinanceMarketDataProvider(binanceClient),
    limits,
    store,
    challengesEnabled: process.env.RISK_CHALLENGER_ENABLED !== 'false',
    execution,
    portfolio: new PortfolioEngine({
      broker, limits,
      fallbackEquity: Number(process.env.PAPER_INITIAL_FUTURES_BALANCE ?? 10_000),
    }),
  };
  const reconciler = new Reconciler(broker, parts.execution, parts.store);
  const deps = buildPipelineDeps(parts, ollamaClient, router, broker);
  const assess = (proposal: TradeProposal, state: MarketState): AssessResult =>
    assessProposal(deps, proposal, state);
  const executor = deps.execute as NonNullable<typeof deps.execute>;

  return {
    venue, provider: parts.provider, broker, router, limits: parts.limits,
    portfolio: parts.portfolio, execution: parts.execution, reconciler,
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
