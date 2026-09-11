import { Decimal } from 'decimal.js';
import type { Candle, DisplacementEvent, Timeframe } from './types.js';
export interface DisplacementOptions {
    readonly symbol: string;
    readonly timeframe: Timeframe;
    readonly minMagnitudeAtr?: Decimal;
    readonly minBodyRatio?: Decimal;
}
/**
 * Detects aggressive directional displacement candles based on ATR expansion and body dominance.
 */
export declare function detectDisplacement(candles: readonly Candle[], options: DisplacementOptions): DisplacementEvent[];
//# sourceMappingURL=displacement.d.ts.map