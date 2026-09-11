import { Decimal } from 'decimal.js';
import type { Candle, SwingPoint, Timeframe, WyckoffEvent } from './types.js';
export interface WyckoffOptions {
    readonly symbol: string;
    readonly timeframe: Timeframe;
    readonly maxPenetrationAtr?: Decimal;
}
/**
 * Detects Wyckoff structural events (Springs and Upthrusts) deterministically.
 * Spring: Price penetrates below a support level (e.g. established swing low) and immediately reclaims.
 * Upthrust: Price penetrates above a resistance level (established swing high) and reclaims.
 */
export declare function detectWyckoffEvents(candles: readonly Candle[], swings: readonly SwingPoint[], options: WyckoffOptions): WyckoffEvent[];
//# sourceMappingURL=wyckoff.d.ts.map