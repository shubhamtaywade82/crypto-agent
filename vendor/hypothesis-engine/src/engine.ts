import type { Candle, Timeframe, BaseEvent } from '@nemesis-oss/market-events';
import {
  detectFvg,
  detectSwings,
  detectStructureBreaks,
  detectBos,
  detectChoch,
  detectMss,
  detectOrderBlocks,
  detectLiquiditySweeps,
  detectDisplacement,
} from '@nemesis-oss/market-events';
import { runObservationStudy, runWalkForwardValidation } from '@nemesis-oss/market-research';
import { classifyRegime, type CompositeRegime } from '@nemesis-oss/regime-engine';

/**
 * A research hypothesis proposed by the LLM and tested by the engine.
 *
 * Example:
 *   "Bullish FVGs are more reliable when:
 *    - HTF structure is bullish
 *    - price has swept sell-side liquidity
 *    - displacement > 1.5 ATR
 *    - OI is increasing"
 */
export interface Hypothesis {
  readonly id: string;
  readonly description: string;
  readonly symbol: string;
  readonly timeframe: Timeframe;
  /** The event type being tested (e.g. "fvg"). */
  readonly eventType: string;
  /** The target metric (default "hit2R"). */
  readonly targetMetric?: 'hit1R' | 'hit2R' | 'hit3R';
  /** Optional regime filter: only test events in this regime. */
  readonly regimeFilter?: Partial<CompositeRegime> | undefined;
  /** Optional displacement threshold (in ATR multiples). */
  readonly minDisplacementAtr?: number | undefined;
  /** Whether to require a prior liquidity sweep. */
  readonly requirePriorSweep?: boolean | undefined;
  /** Horizon for outcome evaluation. Default 24 candles. */
  readonly horizonCandles?: number | undefined;
}

/**
 * The verdict on a hypothesis after deterministic testing.
 */
export type HypothesisVerdict =
  | 'validated'
  | 'rejected'
  | 'inconclusive'
  | 'insufficient_sample';

export interface HypothesisResult {
  readonly hypothesis: Hypothesis;
  readonly verdict: HypothesisVerdict;
  readonly sampleSize: number;
  readonly reachRate: number;
  readonly baselineRate: number;
  readonly uplift: number;
  readonly pValue: number;
  readonly isFdrSignificant: boolean;
  readonly oosReachRate?: number | undefined;
  readonly oosDegradation?: number | undefined;
  readonly evidenceSummary: string;
  readonly testedAt: number;
}

export interface TestHypothesisOptions {
  readonly candles: readonly Candle[];
  readonly htfCandles?: Readonly<Partial<Record<Timeframe, readonly Candle[]>>>;
  readonly trainCandlesCount?: number;
  readonly testCandlesCount?: number;
  readonly stepCandlesCount?: number;
}

/**
 * Test a hypothesis deterministically.
 *
 * 1. Detect events of the hypothesis's event type.
 * 2. Apply the hypothesis's filters (regime, displacement, prior sweep).
 * 3. Run the empirical study on the filtered event set.
 * 4. If sample is sufficient, run walk-forward OOS validation.
 * 5. Return a verdict: validated / rejected / inconclusive / insufficient_sample.
 */
export function testHypothesis(
  hypothesis: Hypothesis,
  options: TestHypothesisOptions,
): HypothesisResult {
  const { candles } = options;
  const { symbol, timeframe, eventType } = hypothesis;
  const horizonCandles = hypothesis.horizonCandles ?? 24;

  // 1. Detect all events of the hypothesis's type.
  const allEvents = detectEventsByType(candles, eventType, symbol, timeframe);
  if (allEvents.length === 0) {
    return insufficientSample(hypothesis, 0);
  }

  // 2. Apply filters.
  const filteredEvents = applyFilters(hypothesis, candles, allEvents);
  if (filteredEvents.length < 30) {
    return insufficientSample(hypothesis, filteredEvents.length);
  }

  // 3. Run empirical study on the full dataset (baseline).
  const study = runObservationStudy(candles, {
    symbol,
    timeframe,
    horizonCandles,
  });
  const componentResult = study.results.find((r) => r.eventType === eventType);
  if (!componentResult || !componentResult.baselineComparisonR2) {
    return insufficientSample(hypothesis, filteredEvents.length);
  }

  const baseline = componentResult.baselineComparisonR2;
  const reachRate = componentResult.reachRates.r2;
  const baselineRate = baseline.baselineProbability;
  const uplift = baseline.uplift;
  const pValue = baseline.pValueEstimate;
  const isFdrSignificant = baseline.isFdrSignificant ?? false;

  // 4. Walk-forward OOS validation (if dataset is large enough).
  let oosReachRate: number | undefined;
  let oosDegradation: number | undefined;
  if (
    options.trainCandlesCount &&
    options.testCandlesCount &&
    options.stepCandlesCount &&
    candles.length >= options.trainCandlesCount + options.testCandlesCount
  ) {
    try {
      const wf = runWalkForwardValidation(candles, {
        symbol,
        timeframe,
        trainCandlesCount: options.trainCandlesCount,
        testCandlesCount: options.testCandlesCount,
        stepCandlesCount: options.stepCandlesCount,
        horizonCandles,
      });
      const wfResult = wf.stability.find((s) => s.component === eventType);
      if (wfResult) {
        oosReachRate = wfResult.meanTestHitRateR2;
        oosDegradation = wfResult.hitRateDegradation;
      }
    } catch {
      // Walk-forward may fail on small datasets; skip gracefully.
    }
  }

  // 5. Determine verdict.
  let verdict: HypothesisVerdict;
  if (uplift <= 0 || pValue >= 0.05) {
    verdict = 'rejected';
  } else if (oosReachRate !== undefined && oosDegradation !== undefined) {
    if (oosDegradation > 0.1) {
      verdict = 'rejected'; // edge disappeared OOS
    } else if (isFdrSignificant) {
      verdict = 'validated';
    } else {
      verdict = 'inconclusive';
    }
  } else if (isFdrSignificant) {
    verdict = 'validated';
  } else {
    verdict = 'inconclusive';
  }

  const evidenceSummary = buildEvidenceSummary(
    hypothesis,
    verdict,
    filteredEvents.length,
    reachRate,
    baselineRate,
    uplift,
    pValue,
    isFdrSignificant,
    oosReachRate,
    oosDegradation,
  );

  return {
    hypothesis,
    verdict,
    sampleSize: filteredEvents.length,
    reachRate,
    baselineRate,
    uplift,
    pValue,
    isFdrSignificant,
    ...(oosReachRate !== undefined ? { oosReachRate } : {}),
    ...(oosDegradation !== undefined ? { oosDegradation } : {}),
    evidenceSummary,
    testedAt: Date.now(),
  };
}

function insufficientSample(
  hypothesis: Hypothesis,
  sampleSize: number,
): HypothesisResult {
  return {
    hypothesis,
    verdict: 'insufficient_sample',
    sampleSize,
    reachRate: 0,
    baselineRate: 0,
    uplift: 0,
    pValue: 1,
    isFdrSignificant: false,
    evidenceSummary: `Insufficient sample (${sampleSize} events; need >= 30).`,
    testedAt: Date.now(),
  };
}

function detectEventsByType(
  candles: readonly Candle[],
  eventType: string,
  symbol: string,
  timeframe: Timeframe,
): readonly BaseEvent[] {
  const swings = detectSwings(candles, { leftBars: 2, rightBars: 2 });
  const structure = detectStructureBreaks(candles, swings, { symbol, timeframe });
  switch (eventType) {
    case 'fvg': return detectFvg(candles, { symbol, timeframe });
    case 'bos': return detectBos(candles, swings, { symbol, timeframe });
    case 'choch': return detectChoch(candles, swings, { symbol, timeframe });
    case 'mss': return detectMss(candles, swings, { symbol, timeframe });
    case 'order_block': return detectOrderBlocks(candles, structure, { symbol, timeframe });
    case 'liquidity_sweep': return detectLiquiditySweeps(candles, swings, { symbol, timeframe });
    case 'displacement': return detectDisplacement(candles, { symbol, timeframe });
    default: return [];
  }
}

function applyFilters(
  hypothesis: Hypothesis,
  candles: readonly Candle[],
  events: readonly BaseEvent[],
): readonly BaseEvent[] {
  let filtered = events;

  // Regime filter
  if (hypothesis.regimeFilter) {
    filtered = filtered.filter((ev) => {
      const regime = classifyRegime(
        candles,
        ev.availableAtIndex,
        ev.symbol,
        ev.timeframe,
      );
      if (hypothesis.regimeFilter!.trend && regime.trend !== hypothesis.regimeFilter!.trend) {
        return false;
      }
      if (hypothesis.regimeFilter!.volatility && regime.volatility !== hypothesis.regimeFilter!.volatility) {
        return false;
      }
      return true;
    });
  }

  // Displacement filter
  if (hypothesis.minDisplacementAtr !== undefined) {
    const displacements = detectDisplacement(candles, {
      symbol: hypothesis.symbol,
      timeframe: hypothesis.timeframe,
    });
    const displacementByIndex = new Map(
      displacements.map((d) => [d.candleIndex, d]),
    );
    filtered = filtered.filter((ev) => {
      const disp = displacementByIndex.get(ev.originIndex);
      if (!disp) return false;
      return disp.magnitudeAtr.toNumber() >= hypothesis.minDisplacementAtr!;
    });
  }

  // Prior sweep filter
  if (hypothesis.requirePriorSweep) {
    const swings = detectSwings(candles, { leftBars: 2, rightBars: 2 });
    const sweeps = detectLiquiditySweeps(candles, swings, {
      symbol: hypothesis.symbol,
      timeframe: hypothesis.timeframe,
    });
    const sweepIndices = new Set(sweeps.map((s) => s.availableAtIndex));
    filtered = filtered.filter((ev) => {
      // Check if a sweep occurred within 5 bars before this event.
      for (let i = Math.max(0, ev.availableAtIndex - 5); i < ev.availableAtIndex; i++) {
        if (sweepIndices.has(i)) return true;
      }
      return false;
    });
  }

  return filtered;
}

function buildEvidenceSummary(
  hypothesis: Hypothesis,
  verdict: HypothesisVerdict,
  sampleSize: number,
  reachRate: number,
  baselineRate: number,
  uplift: number,
  pValue: number,
  isFdrSignificant: boolean,
  oosReachRate?: number,
  oosDegradation?: number,
): string {
  const parts: string[] = [
    `Verdict: ${verdict}`,
    `Sample: n=${sampleSize}`,
    `Reach rate (2R): ${(reachRate * 100).toFixed(1)}%`,
    `Baseline: ${(baselineRate * 100).toFixed(1)}%`,
    `Uplift: ${(uplift * 100).toFixed(1)}pp`,
    `p-value: ${pValue.toFixed(4)}`,
    `FDR significant: ${isFdrSignificant}`,
  ];
  if (oosReachRate !== undefined) {
    parts.push(`OOS reach rate: ${(oosReachRate * 100).toFixed(1)}%`);
  }
  if (oosDegradation !== undefined) {
    parts.push(`OOS degradation: ${(oosDegradation * 100).toFixed(1)}pp`);
  }
  return parts.join('; ');
}
