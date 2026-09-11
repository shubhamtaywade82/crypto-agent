import type { Candle, Timeframe } from '@nemesis-oss/market-events';
import type { HtfRegimeSnapshot } from './types.js';
export { HtfRegimeSnapshot };
export type HtfCandlesMap = Readonly<Partial<Record<Timeframe, readonly Candle[]>>>;
export type MultiTimeframeSnapshot = Readonly<Partial<Record<Timeframe, HtfRegimeSnapshot>>>;
export declare function timeframeToMs(tf: Timeframe): number;
/**
 * Returns candles from higher timeframe that were strictly COMPLETED prior to or at eventTimestamp.
 * Guarantees zero lookahead bias from unclosed higher timeframe candles.
 */
export declare function getCausalHtfCandles(htfCandles: readonly Candle[], eventTimestamp: number, htf: Timeframe): readonly Candle[];
/**
 * Extracts causal multi-timeframe context strictly as-of event timestamp.
 */
export declare function extractCausalHtfContext(htfCandles: readonly Candle[], eventTimestamp: number, htf: Timeframe): HtfRegimeSnapshot | null;
/**
 * Extracts causal multi-timeframe snapshots across multiple higher timeframes.
 */
export declare function extractMultiTimeframeSnapshot(htfCandlesMap: HtfCandlesMap, eventTimestamp: number): MultiTimeframeSnapshot;
//# sourceMappingURL=multi-timeframe.d.ts.map