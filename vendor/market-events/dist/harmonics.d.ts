import { Decimal } from 'decimal.js';
import type { HarmonicPatternEvent, HarmonicPatternType, SwingPoint, Timeframe } from './types.js';
export interface HarmonicRatioConfig {
    readonly name: HarmonicPatternType;
    readonly bRetraceMin: Decimal;
    readonly bRetraceMax: Decimal;
    readonly dRetraceMin: Decimal;
    readonly dRetraceMax: Decimal;
}
export interface HarmonicOptions {
    readonly symbol: string;
    readonly timeframe: Timeframe;
}
/**
 * Detects 5-point XABCD harmonic patterns (Gartley, Bat) from swing pivot sequences.
 */
export declare function detectHarmonicPatterns(swings: readonly SwingPoint[], options: HarmonicOptions): HarmonicPatternEvent[];
//# sourceMappingURL=harmonics.d.ts.map