import type { FvgOutcome, BaseOutcome } from './types.js';
export interface SurvivalStep {
    readonly bars: number;
    readonly survivalRate: number;
    readonly cumulativeTargetRate: number;
    readonly cumulativeStopRate: number;
    readonly cumulativeNeitherRate: number;
}
export interface TimeToEventProfile {
    readonly sampleSize: number;
    readonly medianBarsToTouch: number | null;
    readonly medianBarsToTarget: number | null;
    readonly medianBarsToStop: number | null;
    readonly survivalCurve: readonly SurvivalStep[];
}
/**
 * Computes non-parametric empirical survival curves and competing-risk time-to-event distributions.
 */
export declare function computeTimeToEventProfile(outcomes: readonly (FvgOutcome | BaseOutcome)[], maxHorizonBars?: number): TimeToEventProfile;
export interface QuantileSummary {
    readonly p10: number;
    readonly p25: number;
    readonly p50: number;
    readonly p75: number;
    readonly p90: number;
}
export interface ExcursionStep {
    readonly thresholdAtr: number;
    readonly probabilityExceeding: number;
}
export interface OutcomeDistribution {
    readonly sampleSize: number;
    readonly mfeAtrQuantiles: QuantileSummary | null;
    readonly maeAtrQuantiles: QuantileSummary | null;
    readonly mfeDistribution: readonly ExcursionStep[];
    readonly maeDistribution: readonly ExcursionStep[];
}
/**
 * Computes non-parametric empirical excursion distributions (MFE/MAE quantiles and threshold exceedance).
 */
export declare function computeOutcomeDistribution(outcomes: readonly BaseOutcome[], atrThresholds?: readonly number[]): OutcomeDistribution;
//# sourceMappingURL=time-to-event.d.ts.map