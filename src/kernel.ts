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
import { runTradingPipeline, type PipelineTrace } from './engines/pipeline.js';
import { analyzeMarket } from './agents/analyst-agent.js';
import { strategize } from './agents/strategist-agent.js';
import { challengeProposal } from './agents/risk-challenger.js';
import type { TradeProposal } from './domain/orders/trade-proposal.js';
import type { SizingResult } from './engines/position-sizer.js';
import type { RiskDecision } from './domain/risk/risk-decision.js';
import type { TrackedOrder } from './engines/execution-engine.js';
import { binanceClient, defaultModel, ollamaClient } from './config.js';

export type ExecutionVenue = 'paper' | 'coindcx';

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

export const createKernel = (venueOverride?: ExecutionVenue): TradingKernel => {
  const log = createLogger('kernel');
  const venue: ExecutionVenue =
    venueOverride ?? (process.env.EXECUTION_VENUE as ExecutionVenue | undefined) ?? 'paper';
  const { broker, router } = buildBroker(venue, log);
  const provider = new BinanceMarketDataProvider(binanceClient);
  const limits = loadRiskLimits();
  const store = new EventStore();
  const execution = new ExecutionEngine(broker, store);
  const portfolio = new PortfolioEngine({
    broker, limits, fallbackEquity: Number(process.env.PAPER_INITIAL_FUTURES_BALANCE ?? 10_000),
  });
  const reconciler = new Reconciler(broker, execution, store);
  const challengesEnabled = process.env.RISK_CHALLENGER_ENABLED !== 'false';
  const ollama: OllamaClient = ollamaClient;

  return {
    venue, provider, broker, router, limits, portfolio, execution, reconciler,
    lanes: new SymbolLanes(), store, log,
    runPipeline: (symbol: string): Promise<PipelineTrace> => runTradingPipeline({
      provider, limits, portfolio, execution, store, challengesEnabled,
      analyze: (state) => analyzeMarket(ollama, defaultModel, state),
      strategize: (request) => strategize(ollama, defaultModel, request),
      challenge: (proposal, state) => challengeProposal(ollama, defaultModel, proposal, state),
      execute: buildExecutor(broker, router, execution),
    }, symbol),
  };
};

let singleton: TradingKernel | undefined;

export const getKernel = (): TradingKernel => {
  if (!singleton) singleton = createKernel();
  return singleton;
};
