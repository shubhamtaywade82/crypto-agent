import { Decimal } from 'decimal.js';
import { z } from 'zod';
import { defineTool, ToolRegistry, type AnyTool } from '@nemesis-oss/ollama-sdk';
import {
  spotTools,
  type BinanceClient,
  type ToolContext,
  type ToolDefinition as BinanceToolDefinition,
} from '@nemesis-oss/binance-sdk';
import { binanceRateLimiter } from './guardians/rate-limiter.js';
import type { WatchOrchestrator } from './engine/orchestrator.js';
import type { TradeProposal } from './domain/orders/trade-proposal.js';
import { buildMarketState } from './engines/market-state-engine.js';
import {
  createRegisterWatchTool,
  createListWatchesTool,
  createRemoveWatchTool,
} from './engine/watch-tools.js';
import {
  createLogTradeSetupTool,
  createRecordTradeOutcomeTool,
  createGetTradeJournalTool,
  createGetLearnedRulesTool,
} from './engine/journal-tools.js';
import { createKernelTools } from './tools-kernel.js';
import { getKernel } from './kernel.js';

export const adaptBinanceTool = (tool: BinanceToolDefinition, ctx: ToolContext): AnyTool =>
  defineTool({
    name: tool.name,
    description: tool.description,
    schema: tool.inputSchema,
    execute: async (args) => {
      // Guard against Binance API rate limits and IP ban thresholds
      await binanceRateLimiter.requestPermission(tool.name);
      return tool.handler(args, ctx);
    },
  });

const positionSizeSchema = z.object({
  accountBalance: z.string().describe('Total balance in USDT'),
  riskPercent: z.string().describe('Percent of account to risk (e.g. 1.5)'),
  entryPrice: z.string().describe('Intended entry price in USDT'),
  stopLossPrice: z.string().describe('Stop loss price in USDT'),
});

type PositionSizeInput = z.infer<typeof positionSizeSchema>;

const executePositionSize = (input: PositionSizeInput): Record<string, string> => {
  const balance = new Decimal(input.accountBalance);
  const riskPct = new Decimal(input.riskPercent);
  const entry = new Decimal(input.entryPrice);
  const stopLoss = new Decimal(input.stopLossPrice);

  if (!balance.greaterThan(0) || !riskPct.greaterThan(0)) {
    throw new Error('Balance and risk percentage must be strictly positive');
  }

  const riskPerUnit = entry.minus(stopLoss).abs();
  if (riskPerUnit.isZero()) {
    throw new Error('Entry price and stop loss price cannot be identical');
  }

  const riskAmount = balance.times(riskPct.dividedBy(100));
  // Round down quantity to 4 decimal places to prevent exceeding exchange lot size constraints
  const quantity = riskAmount.dividedBy(riskPerUnit).toDecimalPlaces(4, Decimal.ROUND_DOWN);
  const notional = quantity.times(entry).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);

  return {
    quantity: quantity.toFixed(4),
    riskAmount: riskAmount.toFixed(2),
    notional: notional.toFixed(2),
    riskPerUnit: riskPerUnit.toFixed(4),
  };
};

export const createPositionSizeTool = (): AnyTool =>
  defineTool({
    name: 'calculate_position_size',
    description: 'Calculate exact risk-adjusted position size using Decimal arithmetic',
    schema: positionSizeSchema,
    execute: async (input) => executePositionSize(input),
  });

// Core subset of public market data tools (no private/signed API keys required)
export const CORE_SPOT_TOOLS = [
  'spot_ping',
  'spot_server_time',
  'spot_exchange_info',
  'spot_ticker_price',
  'spot_ticker_24hr',
  'spot_book_ticker',
  'spot_order_book',
  'spot_recent_trades',
  'spot_klines',
  'spot_avg_price',
] as const;

const paperOrderSchema = z.object({
  symbol: z.string().describe('Trading pair symbol, e.g. SOLUSDT'),
  side: z.enum(['BUY', 'SELL']),
  stopLoss: z.number().describe('REQUIRED stop loss price (kernel refuses naked orders)'),
  takeProfit: z.number().describe('REQUIRED take profit price'),
  confidence: z.number().min(0).max(1).default(0.7),
  thesis: z.string().default('agent order'),
});

type PaperOrderInput = z.infer<typeof paperOrderSchema>;

const gatedProposal = (input: PaperOrderInput, price: number): TradeProposal => ({
  symbol: input.symbol.toUpperCase(),
  direction: input.side === 'BUY' ? 'LONG' : 'SHORT',
  entry: price,
  stopLoss: input.stopLoss,
  takeProfit: input.takeProfit,
  orderType: 'MARKET',
  leverage: 1,
  setupType: 'AGENT_ORDER',
  confidence: input.confidence,
  thesis: input.thesis,
  invalidation: `stop ${input.stopLoss}`,
  source: 'LLM_STRATEGIST',
});

/**
 * Risk-gated order entry. The LLM can no longer place naked orders:
 * every order passes validate -> size -> RiskEngine -> execute. Position
 * size is computed by the kernel sizer, never by the model.
 */
const executeGatedOrder = async (input: PaperOrderInput): Promise<Record<string, unknown>> => {
  const kernel = getKernel();
  const symbol = input.symbol.toUpperCase();
  const mtf = await buildMarketState(kernel.provider, symbol);
  const proposal = gatedProposal(input, mtf.state.price.last);
  const assessed = kernel.assess(proposal, mtf.state);
  if (!assessed.risk.approved) {
    return {
      status: 'REJECTED_BY_RISK_ENGINE',
      decisionId: assessed.risk.decisionId,
      rejections: assessed.risk.rejections,
      reasons: assessed.risk.reasons,
      checks: assessed.risk.checks,
    };
  }
  const order = await kernel.executeProposal(proposal, assessed.sizing, assessed.risk);
  return {
    status: order.status,
    decisionId: assessed.risk.decisionId,
    orderId: order.orderId,
    quantity: assessed.sizing.quantity,
    notional: assessed.sizing.notional,
    leverage: assessed.sizing.leverage,
    riskAmount: assessed.sizing.riskAmount,
  };
};

export const createPaperBrokerOrderTool = (): AnyTool =>
  defineTool({
    name: 'paper_broker_place_order',
    description:
      'Place a risk-gated market order (paper venue by default). Requires stopLoss ' +
      'and takeProfit. Size is computed by the RiskEngine — you do not choose quantity.',
    schema: paperOrderSchema,
    execute: async (input) => executeGatedOrder(input),
  });

export const createPaperBrokerPositionsTool = (): AnyTool =>
  defineTool({
    name: 'paper_broker_get_positions',
    description: 'Fetch open positions and balances from the configured execution venue.',
    schema: z.object({}),
    execute: async () => {
      const kernel = getKernel();
      const [positions, balances] = await Promise.all([
        kernel.broker.getPositions(),
        kernel.broker.getBalances(),
      ]);
      return { venue: kernel.broker.id, positions, balances };
    },
  });

const getOrchestratorTools = (orch?: WatchOrchestrator): AnyTool[] => {
  if (!orch) return [];
  return [
    createRegisterWatchTool(orch),
    createListWatchesTool(orch),
    createRemoveWatchTool(orch),
    createLogTradeSetupTool(orch.journal),
    createRecordTradeOutcomeTool(orch.journal),
    createGetTradeJournalTool(orch.journal),
    createGetLearnedRulesTool(orch.journal),
  ];
};

export const createTradingRegistry = (
  binance: BinanceClient,
  selectedTools: readonly string[] = CORE_SPOT_TOOLS,
  orchestrator?: WatchOrchestrator
): ToolRegistry => {
  const ctx: ToolContext = {
    env: 'live',
    isSigned: Boolean(process.env.BINANCE_API_KEY),
  };

  const rawTools = spotTools(binance);
  const targetSet = new Set<string>(selectedTools);
  const adaptedTools = rawTools
    .filter((t) => targetSet.has(t.name))
    .map((t) => adaptBinanceTool(t, ctx));
  const kernelTools = process.env.KERNEL_TOOLS === 'false' ? [] : createKernelTools();

  return new ToolRegistry({
    tools: [
      ...adaptedTools,
      createPositionSizeTool(),
      createPaperBrokerOrderTool(),
      createPaperBrokerPositionsTool(),
      ...kernelTools,
      ...getOrchestratorTools(orchestrator),
    ],
    // Fail fast on slow exchange network responses
    timeoutMs: 15_000,
  });
};
