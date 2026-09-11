export interface PredictionPoint {
    readonly probability: number;
    readonly actual: boolean;
}
export interface CalibrationBin {
    readonly binIndex: number;
    readonly lowerBound: number;
    readonly upperBound: number;
    readonly sampleCount: number;
    readonly meanPredictedProbability: number;
    readonly empiricalAccuracy: number;
    readonly calibrationError: number;
}
export interface BrierDecomposition {
    readonly reliability: number;
    readonly resolution: number;
    readonly uncertainty: number;
}
export interface CalibrationMetrics {
    readonly sampleSize: number;
    readonly brierScore: number;
    readonly expectedCalibrationError: number;
    readonly maximumCalibrationError: number;
    readonly baseRate: number;
    readonly brierDecomposition: BrierDecomposition;
    readonly bins: readonly CalibrationBin[];
}
export declare function computeBrierScore(predictions: readonly PredictionPoint[]): number;
export declare function partitionIntoBins(predictions: readonly PredictionPoint[], binCount?: number): readonly CalibrationBin[];
export declare function computeCalibrationMetrics(predictions: readonly PredictionPoint[], binCount?: number): CalibrationMetrics;
//# sourceMappingURL=calibration.d.ts.map