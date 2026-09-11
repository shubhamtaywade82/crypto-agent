import type { Candle } from '@nemesis-oss/market-events';
import type { RawKlineRecord } from './types.js';
/**
 * Normalizes raw exchange records to canonical Candle instances with Decimal precision.
 */
export declare function normalizeCandle(raw: RawKlineRecord): Candle;
/**
 * Deduplicates and sorts candles chronologically by UTC timestamp.
 */
export declare function sanitizeCandles(candles: readonly Candle[]): Candle[];
//# sourceMappingURL=candle-normalizer.d.ts.map