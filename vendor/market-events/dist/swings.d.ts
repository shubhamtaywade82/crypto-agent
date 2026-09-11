import type { Candle, SwingPoint, SwingStrength } from './types.js';
export interface SwingDetectionOptions {
    readonly leftBars?: number;
    readonly rightBars?: number;
    readonly strength?: SwingStrength;
}
export declare const SWING_PRESETS: Record<SwingStrength, {
    leftBars: number;
    rightBars: number;
}>;
/**
 * Detects swing highs and swing lows using symmetrical left/right bar confirmation.
 */
export declare function detectSwings(candles: readonly Candle[], options?: SwingDetectionOptions): SwingPoint[];
/**
 * Detects multi-scale market swings across micro, minor, intermediate, and major resolutions.
 */
export declare function detectMultiScaleSwings(candles: readonly Candle[]): Record<'micro' | 'minor' | 'intermediate' | 'major', SwingPoint[]>;
//# sourceMappingURL=swings.d.ts.map