import type { BootstrapConfidenceInterval } from './types.js';

export interface ConfidenceInterval {
  readonly lower: number;
  readonly upper: number;
  readonly confidenceLevel: number;
}

/**
 * Calculates Wilson score interval for binomial proportions (e.g. hit rates).
 */
export function calculateWilsonInterval(
  successes: number,
  trials: number,
  z: number = 1.96
): ConfidenceInterval {
  if (trials === 0) {
    return { lower: 0, upper: 0, confidenceLevel: 0.95 };
  }

  const p = successes / trials;
  const z2 = z * z;
  const denominator = 1 + z2 / trials;
  const center = p + z2 / (2 * trials);
  const spread = z * Math.sqrt((p * (1 - p)) / trials + z2 / (4 * trials * trials));

  const lower = Math.max(0, (center - spread) / denominator);
  const upper = Math.min(1, (center + spread) / denominator);

  return { lower, upper, confidenceLevel: 0.95 };
}

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
export function calculateClusterEffectiveSampleSize(
  clusterSizes: readonly number[],
  icc: number = 0.25
): { effectiveN: number; designEffect: number } {
  const totalN = clusterSizes.reduce((sum, s) => sum + s, 0);
  if (totalN === 0 || clusterSizes.length === 0) {
    return { effectiveN: 0, designEffect: 1 };
  }

  const meanM = totalN / clusterSizes.length;
  const designEffect = Math.max(1, 1 + (meanM - 1) * icc);
  const effectiveN = Math.max(1, Math.round(totalN / designEffect));

  return { effectiveN, designEffect };
}

export interface ClusterObservation {
  readonly hits: number;
  readonly trials: number;
  readonly clusterId?: string | undefined;
}

export interface ClusterBootstrapResult {
  readonly pValue: number;
  readonly standardError: number;
  readonly confidenceInterval: { readonly lower: number; readonly upper: number };
}

export function createMulberry32(seed: number = 42): () => number {
  let a = seed >>> 0;
  return () => {
    let t = (a += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Calculates non-parametric bootstrap confidence interval for medians (MFE/MAE ATR).
 */
export function calculateBootstrapMedianCi(
  values: readonly number[],
  iterations: number = 500,
  seed: number = 42
): BootstrapConfidenceInterval {
  if (values.length === 0) return { lower: 0, upper: 0, pointEstimate: 0, standardError: 0 };
  const sorted = [...values].sort((a, b) => a - b);
  const pointEstimate = sorted[Math.floor(sorted.length / 2)]!;
  if (values.length === 1) return { lower: pointEstimate, upper: pointEstimate, pointEstimate, standardError: 0 };

  const medians: number[] = [];
  const rand = createMulberry32(seed);
  for (let b = 0; b < iterations; b++) {
    const sample: number[] = [];
    for (let i = 0; i < values.length; i++) {
      sample.push(values[Math.floor(rand() * values.length)]!);
    }
    sample.sort((a, b) => a - b);
    medians.push(sample[Math.floor(values.length / 2)]!);
  }

  medians.sort((a, b) => a - b);
  const lowIdx = Math.floor(iterations * 0.025);
  const highIdx = Math.min(iterations - 1, Math.ceil(iterations * 0.975));
  const meanBoot = medians.reduce((s, v) => s + v, 0) / iterations;
  const variance = medians.reduce((s, v) => s + Math.pow(v - meanBoot, 2), 0) / iterations;

  return { lower: medians[lowIdx]!, upper: medians[highIdx]!, pointEstimate, standardError: Math.sqrt(variance) };
}

export function calculateClusterBootstrapComparison(
  eventClusters: readonly ClusterObservation[],
  baselineClusters: readonly ClusterObservation[],
  iterations: number = 1000,
  seed: number = 42
): ClusterBootstrapResult {
  if (eventClusters.length === 0 || baselineClusters.length === 0) {
    return { pValue: 1.0, standardError: 0, confidenceInterval: { lower: 0, upper: 0 } };
  }
  const rand = createMulberry32(seed);
  const uplifts: number[] = [];
  for (let b = 0; b < iterations; b++) {
    let evHits = 0, evTrials = 0, baseHits = 0, baseTrials = 0;
    for (let i = 0; i < eventClusters.length; i++) {
      const c = eventClusters[Math.floor(rand() * eventClusters.length)]!;
      evHits += c.hits; evTrials += c.trials;
    }
    for (let i = 0; i < baselineClusters.length; i++) {
      const c = baselineClusters[Math.floor(rand() * baselineClusters.length)]!;
      baseHits += c.hits; baseTrials += c.trials;
    }
    const pEv = evTrials > 0 ? evHits / evTrials : 0;
    const pBase = baseTrials > 0 ? baseHits / baseTrials : 0;
    uplifts.push(pEv - pBase);
  }
  uplifts.sort((a, b) => a - b);
  const lowIdx = Math.floor(iterations * 0.025);
  const highIdx = Math.min(iterations - 1, Math.ceil(iterations * 0.975));
  const meanU = uplifts.reduce((s, u) => s + u, 0) / iterations;
  const variance = uplifts.reduce((s, u) => s + (u - meanU) ** 2, 0) / iterations;
  const nullCount = uplifts.filter(u => u <= 0).length;
  const pValue = Math.min(1.0, Math.max(0.001, (nullCount + 1) / (iterations + 1)));

  return { pValue, standardError: Math.sqrt(variance), confidenceInterval: { lower: uplifts[lowIdx]!, upper: uplifts[highIdx]! } };
}

export interface MatchedPairObservation {
  readonly eventHit: boolean | number;
  readonly controlHit: boolean | number;
  readonly clusterId?: string | undefined;
}

export interface PairedBootstrapResult {
  readonly meanDifference: number;
  readonly standardError: number;
  readonly pValue: number;
  readonly confidenceInterval: { lower: number; upper: number };
}

export function calculatePairedBootstrapComparison(
  pairs: readonly MatchedPairObservation[],
  iterations = 1000
): PairedBootstrapResult {
  const n = pairs.length;
  if (n === 0) return { meanDifference: 0, standardError: 0, pValue: 1.0, confidenceInterval: { lower: 0, upper: 0 } };

  const diffs = pairs.map(p => Number(p.eventHit) - Number(p.controlHit));
  const meanDiff = diffs.reduce((s, d) => s + d, 0) / n;
  const rand = createMulberry32(42);
  const bootMeans: number[] = [];

  for (let b = 0; b < iterations; b++) {
    let sum = 0;
    for (let i = 0; i < n; i++) sum += diffs[Math.floor(rand() * n)]!;
    bootMeans.push(sum / n);
  }

  bootMeans.sort((a, b) => a - b);
  const lowIdx = Math.floor(iterations * 0.025);
  const highIdx = Math.min(iterations - 1, Math.ceil(iterations * 0.975));
  const bootMean = bootMeans.reduce((s, m) => s + m, 0) / iterations;
  const variance = bootMeans.reduce((s, m) => s + (m - bootMean) ** 2, 0) / iterations;
  const nullCount = bootMeans.filter(m => m <= 0).length;
  const pValue = Math.min(1.0, Math.max(0.001, (nullCount + 1) / (iterations + 1)));

  return {
    meanDifference: meanDiff,
    standardError: Math.sqrt(variance),
    pValue,
    confidenceInterval: { lower: bootMeans[lowIdx]!, upper: bootMeans[highIdx]! }
  };
}

export interface CompareBaselineInput {
  readonly eventHits: number;
  readonly eventTrials: number;
  readonly baselineHits: number;
  readonly baselineTrials: number;
  readonly clusterSizes?: readonly number[] | undefined;
  readonly eventClusters?: readonly ClusterObservation[] | undefined;
  readonly baselineClusters?: readonly ClusterObservation[] | undefined;
}

function parseBaselineInput(
  arg1: CompareBaselineInput | number,
  arg2?: number,
  arg3?: number,
  arg4?: number,
  arg5?: readonly number[]
): CompareBaselineInput {
  if (typeof arg1 === 'object') return arg1;
  return {
    eventHits: arg1,
    eventTrials: arg2 ?? 0,
    baselineHits: arg3 ?? 0,
    baselineTrials: arg4 ?? 0,
    clusterSizes: arg5
  };
}

export function compareAgainstBaseline(
  inputOrHits: CompareBaselineInput | number,
  eventTrials?: number,
  baselineHits?: number,
  baselineTrials?: number,
  clusterSizes?: readonly number[]
): StatisticalEdgeComparison {
  const inp = parseBaselineInput(inputOrHits, eventTrials, baselineHits, baselineTrials, clusterSizes);
  const { eventHits, baselineHits: baseHits, eventTrials: evTrials, baselineTrials: baseTrials } = inp;
  if (evTrials === 0 || baseTrials === 0) {
    return { baselineProbability: 0, eventProbability: 0, uplift: 0, relativeUplift: 0, oddsRatio: 1, sampleSize: evTrials, baselineSampleSize: baseTrials, effectiveSampleSize: evTrials, isStatisticallySignificant: false, pValueEstimate: 1.0 };
  }

  const p1 = eventHits / evTrials;
  const p2 = baseHits / baseTrials;
  const uplift = p1 - p2;
  const relativeUplift = p2 > 0 ? uplift / p2 : 0;
  const odds1 = (p1 >= 1) ? 999 : p1 / Math.max(0.0001, 1 - p1);
  const odds2 = (p2 >= 1) ? 999 : p2 / Math.max(0.0001, 1 - p2);
  const oddsRatio = odds2 > 0 ? odds1 / odds2 : 1;
  const effN = inp.clusterSizes ? calculateClusterEffectiveSampleSize(inp.clusterSizes).effectiveN : evTrials;

  let clusterBootstrap: ClusterBootstrapResult | undefined;
  let pValueEstimate: number;

  if (inp.eventClusters && inp.baselineClusters && inp.eventClusters.length > 0 && inp.baselineClusters.length > 0) {
    clusterBootstrap = calculateClusterBootstrapComparison(inp.eventClusters, inp.baselineClusters);
    pValueEstimate = clusterBootstrap.pValue;
  } else {
    const pPool = (eventHits + baseHits) / (evTrials + baseTrials);
    const sePool = Math.sqrt(pPool * (1 - pPool) * (1 / effN + 1 / baseTrials));
    pValueEstimate = sePool > 0 ? 2 * (1 - normalCdf(Math.abs(uplift / sePool))) : 1.0;
  }

  return {
    baselineProbability: p2,
    eventProbability: p1,
    uplift,
    relativeUplift,
    oddsRatio,
    sampleSize: evTrials,
    baselineSampleSize: baseTrials,
    effectiveSampleSize: effN,
    isStatisticallySignificant: pValueEstimate < 0.05 && uplift > 0,
    pValueEstimate: Math.max(0, Math.min(1, pValueEstimate)),
    ...(clusterBootstrap ? { clusterBootstrap } : {})
  };
}

export function normalCdf(x: number): number {
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;

  const sign = x < 0 ? -1 : 1;
  const absX = Math.abs(x) / Math.sqrt(2);
  const t = 1.0 / (1.0 + p * absX);
  const erf = 1.0 - ((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t * Math.exp(-absX * absX);

  return 0.5 * (1.0 + sign * erf);
}
