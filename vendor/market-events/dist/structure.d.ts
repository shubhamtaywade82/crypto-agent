import type { Candle, StructureBreakEvent, SwingPoint, Timeframe } from './types.js';
export interface StructureOptions {
    readonly symbol: string;
    readonly timeframe: Timeframe;
    readonly requireClose?: boolean;
    readonly dualBreakPolicy?: 'skip' | 'allow_both' | 'close_direction';
}
/**
 * Detects Break of Structure (BOS), Change of Character (CHoCH), and Market Structure Shift (MSS)
 * using an explicit multi-state structure model with same-bar dual break resolution.
 */
export declare function detectStructureBreaks(candles: readonly Candle[], swings: readonly SwingPoint[], options: StructureOptions): StructureBreakEvent[];
/**
 * Detects Break of Structure (BOS) indicating trend continuation.
 */
export declare function detectBos(candles: readonly Candle[], swings: readonly SwingPoint[], options: StructureOptions): StructureBreakEvent[];
/**
 * Detects Change of Character (CHoCH) indicating early counter-trend internal structure breach.
 */
export declare function detectChoch(candles: readonly Candle[], swings: readonly SwingPoint[], options: StructureOptions): StructureBreakEvent[];
/**
 * Detects Market Structure Shift (MSS) indicating external major structural reversal.
 */
export declare function detectMss(candles: readonly Candle[], swings: readonly SwingPoint[], options: StructureOptions): StructureBreakEvent[];
//# sourceMappingURL=structure.d.ts.map