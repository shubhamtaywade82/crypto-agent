import { Decimal } from 'decimal.js';
import type { ChartPatternEvent, SwingPoint, Timeframe } from './types.js';
export interface ChartPatternOptions {
    readonly symbol: string;
    readonly timeframe: Timeframe;
    readonly toleranceRatio?: Decimal;
}
/**
 * Detects classical Double Tops and Double Bottoms from confirmed swing points.
 */
export declare function detectDoublePatterns(swings: readonly SwingPoint[], options: ChartPatternOptions): ChartPatternEvent[];
//# sourceMappingURL=patterns.d.ts.map