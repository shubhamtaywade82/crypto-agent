import type { Timeframe } from '@nemesis-oss/market-events';
import type { ResearchObservation } from './types.js';
export interface NegativeEvidenceFlags {
    readonly hasHtfConflict: boolean;
    readonly isEarlyFailure: boolean;
    readonly isInvalidatedZone: boolean;
    readonly hasCounterTrendRegime: boolean;
}
export declare function checkHtfConflict(obs: ResearchObservation, htf?: Timeframe): boolean;
export declare function checkEarlyFailure(obs: ResearchObservation, maxBars?: number): boolean;
export declare function checkInvalidatedZone(obs: ResearchObservation): boolean;
export declare function classifyNegativeEvidence(obs: ResearchObservation, htf?: Timeframe, maxBarsForEarlyFail?: number): NegativeEvidenceFlags;
export interface NegativeEvidenceImpactResult {
    readonly sampleSize: number;
    readonly alignedCount: number;
    readonly conflictedCount: number;
    readonly alignedHitRateR2: number;
    readonly conflictedHitRateR2: number;
    readonly conflictPenalty: number;
    readonly earlyFailureRate: number;
    readonly netEvidenceScore: number;
}
/**
 * Measures the degradation in empirical hit rate caused by contradictory or negative evidence.
 */
export declare function evaluateNegativeEvidenceImpact(observations: readonly ResearchObservation[], htf?: Timeframe): NegativeEvidenceImpactResult;
//# sourceMappingURL=negative-evidence.d.ts.map