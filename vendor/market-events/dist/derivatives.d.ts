import { Decimal } from 'decimal.js';
import type { DerivativesEvent, DerivativesSnapshot, Timeframe } from './types.js';
export interface DerivativesOptions {
    readonly symbol: string;
    readonly timeframe: Timeframe;
    readonly oiExpansionThreshold?: Decimal;
    readonly fundingExtremeThreshold?: Decimal;
}
/**
 * Detects derivatives events: Open Interest shifts and extreme funding rates as objective observations
 * with exact quantitative measurements and without imposing directional dogma.
 */
export declare function detectDerivativesEvents(snapshots: readonly DerivativesSnapshot[], options: DerivativesOptions): DerivativesEvent[];
//# sourceMappingURL=derivatives.d.ts.map