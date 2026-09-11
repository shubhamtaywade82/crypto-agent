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

export function computeBrierScore(predictions: readonly PredictionPoint[]): number {
  if (predictions.length === 0) return 0;
  const sumSquaredError = predictions.reduce((sum, p) => {
    const y = p.actual ? 1 : 0;
    const err = p.probability - y;
    return sum + err * err;
  }, 0);
  return sumSquaredError / predictions.length;
}

function buildSingleBin(
  pts: readonly PredictionPoint[],
  idx: number,
  binWidth: number
): CalibrationBin {
  const lower = idx * binWidth;
  const upper = (idx + 1) * binWidth;
  const count = pts.length;
  if (count === 0) {
    return {
      binIndex: idx,
      lowerBound: lower,
      upperBound: upper,
      sampleCount: 0,
      meanPredictedProbability: (lower + upper) / 2,
      empiricalAccuracy: 0,
      calibrationError: 0
    };
  }

  const meanProb = pts.reduce((acc, p) => acc + p.probability, 0) / count;
  const accuracy = pts.filter(p => p.actual).length / count;
  return {
    binIndex: idx,
    lowerBound: lower,
    upperBound: upper,
    sampleCount: count,
    meanPredictedProbability: meanProb,
    empiricalAccuracy: accuracy,
    calibrationError: Math.abs(meanProb - accuracy)
  };
}

export function partitionIntoBins(
  predictions: readonly PredictionPoint[],
  binCount: number = 10
): readonly CalibrationBin[] {
  const clampedBins = Math.max(2, Math.min(50, binCount));
  const binWidth = 1 / clampedBins;
  const buckets: PredictionPoint[][] = Array.from({ length: clampedBins }, () => []);

  for (const p of predictions) {
    const clampedProb = Math.max(0, Math.min(1, p.probability));
    const idx = Math.min(clampedBins - 1, Math.floor(clampedProb / binWidth));
    buckets[idx]!.push(p);
  }

  return buckets.map((pts, idx) => buildSingleBin(pts, idx, binWidth));
}

export function computeCalibrationMetrics(
  predictions: readonly PredictionPoint[],
  binCount: number = 10
): CalibrationMetrics {
  const n = predictions.length;
  if (n === 0) {
    return {
      sampleSize: 0, brierScore: 0, expectedCalibrationError: 0,
      maximumCalibrationError: 0, baseRate: 0,
      brierDecomposition: { reliability: 0, resolution: 0, uncertainty: 0 },
      bins: []
    };
  }

  const brierScore = computeBrierScore(predictions);
  const bins = partitionIntoBins(predictions, binCount);
  const baseRate = predictions.filter(p => p.actual).length / n;
  const uncertainty = baseRate * (1 - baseRate);

  let weightedErrorSum = 0;
  let maxError = 0;
  let reliability = 0;
  let resolution = 0;

  for (const b of bins) {
    if (b.sampleCount > 0) {
      const weight = b.sampleCount / n;
      weightedErrorSum += weight * b.calibrationError;
      if (b.calibrationError > maxError) maxError = b.calibrationError;
      reliability += weight * Math.pow(b.meanPredictedProbability - b.empiricalAccuracy, 2);
      resolution += weight * Math.pow(b.empiricalAccuracy - baseRate, 2);
    }
  }

  return {
    sampleSize: n,
    brierScore,
    expectedCalibrationError: weightedErrorSum,
    maximumCalibrationError: maxError,
    baseRate,
    brierDecomposition: { reliability, resolution, uncertainty },
    bins
  };
}
