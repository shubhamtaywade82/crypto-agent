import { Decimal } from 'decimal.js';
import type { Candle as MiCandle, Timeframe as MiTimeframe } from '@nemesis-oss/market-events';
import type { Candle, Timeframe } from '../domain/market/types.js';

const MI_TFS = new Set<string>(['1m', '3m', '5m', '15m', '30m', '1h', '2h', '4h', '6h', '8h', '12h', '1d', '1w', '1M']);

/** Kernel OHLCV (numbers) → market-intelligence candles (Decimal). */
export const toMiCandles = (candles: readonly Candle[]): MiCandle[] =>
  candles.map((c) => ({
    timestamp: c.openTime,
    open: new Decimal(c.open),
    high: new Decimal(c.high),
    low: new Decimal(c.low),
    close: new Decimal(c.close),
    volume: new Decimal(c.volume),
  }));

export const toMiTimeframe = (tf: Timeframe): MiTimeframe => {
  if (!MI_TFS.has(tf)) throw new Error(`unsupported market-intelligence timeframe: ${tf}`);
  return tf as MiTimeframe;
};
