import { Decimal } from 'decimal.js';
import { z } from 'zod';
import { defineTool, ToolRegistry, type AnyTool } from '@nemesis-oss/ollama-sdk';
import type { BinanceClient } from '@nemesis-oss/binance-sdk';

export const createPriceTool = (binance: BinanceClient): AnyTool =>
  defineTool({
    name: 'get_price',
    description: 'Fetch current 24h ticker price, volume, and percent change from Binance',
    schema: z.object({
      symbol: z.string().describe('Trading pair symbol, e.g. BTCUSDT'),
    }),
    execute: async ({ symbol }) => {
      const cleanSymbol = symbol.toUpperCase().replace('/', '');
      const ticker = await binance.spot.market.ticker24hr(cleanSymbol);
      return {
        symbol: cleanSymbol,
        price: ticker.lastPrice,
        change24h: ticker.priceChangePercent,
        volume: ticker.quoteVolume,
        timestamp: Date.now(),
      };
    },
  });

export const createKlinesTool = (binance: BinanceClient): AnyTool =>
  defineTool({
    name: 'get_klines',
    description: 'Fetch OHLCV candlestick data for trend analysis',
    schema: z.object({
      symbol: z.string().describe('Trading pair symbol, e.g. BTCUSDT'),
      interval: z.enum(['1m', '5m', '15m', '1h', '4h', '1d']).default('1h'),
      limit: z.number().min(1).max(500).default(50),
    }),
    execute: async ({ symbol, interval, limit }) => {
      const cleanSymbol = symbol.toUpperCase().replace('/', '');
      const klines = await binance.spot.market.klines(cleanSymbol, interval, { limit });
      // Preserve integer UTC milliseconds instead of Date strings for precision
      return klines.map((k) => ({
        open: k.open,
        high: k.high,
        low: k.low,
        close: k.close,
        volume: k.volume,
        openTime: k.openTime,
      }));
    },
  });

export const createBalanceTool = (binance: BinanceClient): AnyTool =>
  defineTool({
    name: 'get_balance',
    description: 'Fetch current spot account balance for non-zero assets',
    schema: z.object({}),
    execute: async () => {
      const account = await binance.spot.account.account();
      // Use Decimal comparison to avoid floating-point errors
      return account.balances
        .filter((b) => new Decimal(b.free).greaterThan(0) || new Decimal(b.locked).greaterThan(0))
        .map((b) => ({ asset: b.asset, free: b.free, locked: b.locked }));
    },
  });

const placeOrderSchema = z.object({
  symbol: z.string().describe('Trading pair symbol'),
  side: z.enum(['BUY', 'SELL']),
  quantity: z.string().describe('Order quantity in base asset'),
  price: z.string().describe('Limit price in quote asset'),
});

type PlaceOrderInput = z.infer<typeof placeOrderSchema>;

const executePlaceOrder = async (
  binance: BinanceClient,
  input: PlaceOrderInput
): Promise<Record<string, unknown>> => {
  const cleanSymbol = input.symbol.toUpperCase().replace('/', '');
  const qty = new Decimal(input.quantity);
  const px = new Decimal(input.price);
  if (!qty.greaterThan(0) || !px.greaterThan(0)) {
    throw new Error('Quantity and price must be strictly positive');
  }

  // Hard-coded safety ceiling prevents runaway agent losses
  const maxNotional = new Decimal(process.env.MAX_POSITION_NOTIONAL_USDT ?? '5000');
  if (qty.times(px).cmp(maxNotional) > 0) {
    throw new Error(`Order notional exceeds max safety cap of ${maxNotional.toString()} USDT`);
  }

  const order = await binance.spot.trading.createOrder({
    symbol: cleanSymbol,
    side: input.side,
    type: 'LIMIT',
    quantity: qty.toString(),
    price: px.toString(),
    timeInForce: 'GTC',
  });

  return {
    orderId: String(order.orderId),
    symbol: order.symbol,
    side: order.side,
    price: order.price,
    origQty: order.origQty,
    status: order.status,
    timestamp: Date.now(),
  };
};

export const createPlaceOrderTool = (binance: BinanceClient): AnyTool =>
  defineTool({
    name: 'place_limit_order',
    description: 'Place a limit order with pre-trade risk checks',
    schema: placeOrderSchema,
    execute: async (input) => executePlaceOrder(binance, input),
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

export const createTradingRegistry = (binance: BinanceClient): ToolRegistry =>
  new ToolRegistry({
    tools: [
      createPriceTool(binance),
      createKlinesTool(binance),
      createBalanceTool(binance),
      createPlaceOrderTool(binance),
      createPositionSizeTool(),
    ],
    // Prevents network hangs on slow exchange responses
    timeoutMs: 15_000,
  });
