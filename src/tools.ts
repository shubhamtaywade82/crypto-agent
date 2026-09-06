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
import {
  createRegisterWatchTool,
  createListWatchesTool,
  createRemoveWatchTool,
} from './engine/watch-tools.js';

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
  symbol: z.string().describe('Trading pair symbol, e.g. BTCUSDT'),
  side: z.enum(['BUY', 'SELL']),
  quantity: z.string().describe('Order quantity in base asset'),
  orderType: z.enum(['MARKET', 'LIMIT']).default('LIMIT'),
  price: z.string().optional().describe('Limit price in USDT'),
});

type PaperOrderInput = z.infer<typeof paperOrderSchema>;

const executePaperOrder = async (input: PaperOrderInput): Promise<Record<string, unknown>> => {
  const url = `${process.env.PAPER_BROKER_URL ?? 'http://localhost:3000'}/orders`;
  const apiKey = process.env.PAPER_BROKER_API_KEY;
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (apiKey) headers['x-api-key'] = apiKey;

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(input),
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) throw new Error(`Paper broker responded with HTTP ${res.status}`);
    return (await res.json()) as Record<string, unknown>;
  } catch (err) {
    // Non-destructive fallback when paper-broker is offline or unreachable
    return {
      status: 'MOCK_FILLED',
      simulated: true,
      reason: err instanceof Error ? err.message : 'Paper broker unreachable',
      order: input,
    };
  }
};

export const createPaperBrokerOrderTool = (): AnyTool =>
  defineTool({
    name: 'paper_broker_place_order',
    description: 'Submit an order to the local paper-broker flagship platform',
    schema: paperOrderSchema,
    execute: async (input) => executePaperOrder(input),
  });

export const createPaperBrokerPositionsTool = (): AnyTool =>
  defineTool({
    name: 'paper_broker_get_positions',
    description: 'Fetch active open positions from the paper-broker platform',
    schema: z.object({}),
    execute: async () => {
      const url = `${process.env.PAPER_BROKER_URL ?? 'http://localhost:3000'}/positions`;
      try {
        const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
        if (!res.ok) throw new Error(`Paper broker HTTP ${res.status}`);
        return (await res.json()) as Record<string, unknown>;
      } catch {
        return { positions: [], note: 'Paper broker offline or no positions active' };
      }
    },
  });

export const createTradingRegistry = (
  binance: BinanceClient,
  selectedTools: readonly string[] = CORE_SPOT_TOOLS,
  orchestrator?: WatchOrchestrator
): ToolRegistry => {
  const ctx: ToolContext = {
    env: process.env.BINANCE_TESTNET !== 'false' ? 'testnet' : 'live',
    isSigned: Boolean(process.env.BINANCE_API_KEY),
  };

  const rawTools = spotTools(binance);
  const targetSet = new Set<string>(selectedTools);
  const adaptedTools = rawTools
    .filter((t) => targetSet.has(t.name))
    .map((t) => adaptBinanceTool(t, ctx));

  const watchTools = orchestrator
    ? [createRegisterWatchTool(orchestrator), createListWatchesTool(orchestrator), createRemoveWatchTool(orchestrator)]
    : [];

  return new ToolRegistry({
    tools: [
      ...adaptedTools,
      createPositionSizeTool(),
      createPaperBrokerOrderTool(),
      createPaperBrokerPositionsTool(),
      ...watchTools,
    ],
    // Fail fast on slow exchange network responses
    timeoutMs: 15_000,
  });
};
