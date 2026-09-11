import type { Candle, OrderBlockEvent, BreakerBlockEvent, FvgEvent, InvertedFvgEvent, Timeframe } from './types.js';
export interface PolarityOptions {
    readonly symbol: string;
    readonly timeframe: Timeframe;
}
/**
 * Detects Breaker Blocks: An Order Block that failed and got pierced through becomes polarity flipped.
 * Bullish OB invalidated by downward close -> Bearish Breaker.
 * Bearish OB invalidated by upward close -> Bullish Breaker.
 */
export declare function detectBreakerBlocks(candles: readonly Candle[], orderBlocks: readonly OrderBlockEvent[], options: PolarityOptions): BreakerBlockEvent[];
/**
 * Detects Inverted Fair Value Gaps (IFVG): FVG that is closed through flips polarity.
 */
export declare function detectInvertedFvg(candles: readonly Candle[], fvgs: readonly FvgEvent[], options: PolarityOptions): InvertedFvgEvent[];
//# sourceMappingURL=polarity.d.ts.map