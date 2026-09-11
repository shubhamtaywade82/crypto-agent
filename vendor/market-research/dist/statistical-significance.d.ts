import type { BootstrapConfidenceInterval } from './types.js';
export interface ConfidenceInterval {
    readonly lower: number;
    readonly upper: number;
    readonly confidenceLevel: number;
}
/**
 * Calculates Wilson score interval for binomial proportions (e.g. hit rates).
 */
export declare function calculateWilsonInterval(successes: number, trials: number, z?: number): ConfidenceInterval;
export interface StatisticalEdgeComparison {
    readonly baselineProbability: number;
    readonly eventProbability: number;
    readonly uplift: number;
    readonly relativeUplift: number;
    readonly oddsRatio: number;
    readonly sampleSize: number;
    readonly baselineSampleSize: number;
    readonly effectiveSampleSize: number;
    readonly isStatisticallySignificant: boolean;
    readonly pValueEstimate: number;
}
/**
 * Calculates effective sample size accounting for cluster correlation across episodes.
 */
export declare function calculateClusterEffectiveSampleSize(clusterSizes: readonly number[], icc?: number): {
    effectiveN: number;
    designEffect: number;
};
export interface ClusterObservation {
    readonly hits: number;
    readonly trials: number;
    readonly clusterId?: string | undefined;
}
export interface ClusterBootstrapResult {
    readonly pValue: number;
    readonly standardError: number;
    readonly confidenceInterval: {
        readonly lower: number;
        readonly upper: number;
    };
}
export declare function createMulberry32(seed?: number): () => number;
/**
 * Calculates non-parametric bootstrap confidence interval for medians (MFE/MAE ATR).
 */
export declare function calculateBootstrapMedianCi(values: readonly number[], iterations?: number, seed?: number): BootstrapConfidenceInterval;
export declare function calculateClusterBootstrapComparison(eventClusters: readonly ClusterObservation[], baselineClusters: readonly ClusterObservation[], iterations?: number, seed?: number): ClusterBootstrapResult;
export interface MatchedPairObservation {
    readonly eventHit: boolean | number;
    readonly controlHit: boolean | number;
    readonly clusterId?: string | undefined;
}
export interface PairedBootstrapResult {
    readonly meanDifference: number;
    readonly standardError: number;
    readonly pValue: number;
    readonly confidenceInterval: {
        lower: number;
        upper: number;
    };
}
export declare function calculatePairedBootstrapComparison(pairs: readonly MatchedPairObservation[], iterations?: number): PairedBootstrapResult;
export interface CompareBaselineInput {
    readonly eventHits: number;
    readonly eventTrials: number;
    readonly baselineHits: number;
    readonly baselineTrials: number;
    readonly clusterSizes?: readonly number[] | undefined;
    readonly eventClusters?: readonly ClusterObservation[] | undefined;
    readonly baselineClusters?: readonly ClusterObservation[] | undefined;
}
export declare function compareAgainstBaseline(inputOrHits: CompareBaselineInput | number, eventTrials?: number, baselineHits?: number, baselineTrials?: number, clusterSizes?: readonly number[]): StatisticalEdgeComparison;
export declare function normalCdf(x: number): number;
//# sourceMappingURL=statistical-significance.d.ts.map