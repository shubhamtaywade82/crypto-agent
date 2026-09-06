import { Decimal } from 'decimal.js';
import { z } from 'zod';
import { defineTool, ToolRegistry, type AnyTool } from '@nemesis-oss/ollama-sdk';
import {
  spotTools,
  type BinanceClient,
  type ToolContext,
  type ToolDefinition as BinanceToolDefinition,
} from '@nemesis-oss/binance-sdk';

export const adaptBinanceTool = (tool: BinanceToolDefinition, ctx: ToolContext): AnyTool =>
  defineTool({
    name: tool.name,
    description: tool.description,
    schema: tool.inputSchema,
    execute: async (args) => tool.handler(args, ctx),
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

// Core subset of high-signal tools to avoid LLM context bloat while keeping full analytical power
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
  'spot_account',
  'spot_new_order',
  'spot_cancel_order',
  'spot_open_orders',
] as const;

export const createTradingRegistry = (
  binance: BinanceClient,
  selectedTools: readonly string[] = CORE_SPOT_TOOLS
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

  return new ToolRegistry({
    tools: [...adaptedTools, createPositionSizeTool()],
    // Fail fast on slow exchange network responses
    timeoutMs: 15_000,
  });
};
