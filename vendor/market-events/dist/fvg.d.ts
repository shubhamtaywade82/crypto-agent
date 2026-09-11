import { Decimal } from 'decimal.js';
import type { Candle, FvgEvent, Timeframe } from './types.js';
export interface FvgDetectionOptions {
    readonly symbol: string;
    readonly timeframe: Timeframe;
    readonly minGapTicks?: Decimal;
}
/**
 * Detects 3-candle Fair Value Gaps deterministically.
 * Bullish FVG: candle[i-2].high < candle[i].low
 * Bearish FVG: candle[i-2].low > candle[i].high
 */
export declare function detectFvg(candles: readonly Candle[], options: FvgDetectionOptions): FvgEvent[];
//# sourceMappingURL=fvg.d.ts.map