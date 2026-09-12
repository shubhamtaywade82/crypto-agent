import type { Candle, Timeframe } from '@nemesis-oss/market-events';
import { testHypothesis, type Hypothesis, type HypothesisResult } from '@nemesis-oss/hypothesis-engine';

/**
 * A validated strategy candidate discovered by the engine.
 *
 * This is the output of the strategy discovery pipeline: a structured
 * object with entry conditions, context conditions, invalidation,
 * performance metrics, and full provenance.
 */
export interface StrategyCandidate {
  readonly id: string;
  readonly hypothesis: Hypothesis;
  readonly result: HypothesisResult;
  readonly entryConditions: readonly Condition[];
  readonly contextConditions: readonly Condition[];
  readonly invalidation: InvalidationRule;
  readonly targetModel: TargetModel;
  readonly sampleSize: number;
  readonly expectancyR: number;
  readonly winRate: number;
  readonly confidenceInterval: { readonly lower: number; readonly upper: number };
  readonly baselineComparison: { readonly baseline: number; readonly uplift: number };
  readonly oosPerformance?: { readonly reachRate: number; readonly degradation: number } | undefined;
  readonly robustness: RobustnessScore;
  readonly provenance: {
    readonly createdAt: number;
    readonly engineVersion: string;
    readonly datasetHash?: string | undefined;
  };
}

export interface Condition {
  readonly field: string;
  readonly operator: 'eq' | 'gt' | 'lt' | 'in' | 'contains';
  readonly value: unknown;
  readonly description: string;
}

export interface InvalidationRule {
  readonly type: 'stop_loss' | 'time_based' | 'structure_break';
  readonly parameters: Readonly<Record<string, unknown>>;
  readonly description: string;
}

export interface TargetModel {
  readonly targetR: number;
  readonly stopAtrMultiplier: number;
  readonly horizonCandles: number;
}

export type RobustnessLevel = 'high' | 'medium' | 'low';

export interface RobustnessScore {
  readonly level: RobustnessLevel;
  readonly score: number; // 0..1
  readonly factors: readonly string[];
}

export interface StrategyDiscoveryOptions {
  readonly candles: readonly Candle[];
  readonly symbol: string;
  readonly timeframe: Timeframe;
  readonly eventTypes: readonly string[];
  readonly regimeFilters?: readonly Partial<import('@nemesis-oss/regime-engine').CompositeRegime>[];
  readonly horizonCandles?: number;
  readonly trainCandlesCount?: number;
  readonly testCandlesCount?: number;
  readonly stepCandlesCount?: number;
}

/**
 * Discover strategy candidates by testing hypotheses across event types
 * and regime filters.
 *
 * For each (eventType × regimeFilter) combination, the engine:
 *  1. Constructs a hypothesis.
 *  2. Tests it deterministically via {@link testHypothesis}.
 *  3. If the verdict is 'validated' or 'inconclusive', wraps the result
 *     into a {@link StrategyCandidate} with entry conditions, context
 *     conditions, invalidation, and robustness score.
 *
 * Returns candidates sorted by robustness score descending.
 */
export function discoverStrategies(
  options: StrategyDiscoveryOptions,
): readonly StrategyCandidate[] {
  const {
    candles,
    symbol,
    timeframe,
    eventTypes,
    regimeFilters,
    horizonCandles = 24,
    trainCandlesCount,
    testCandlesCount,
    stepCandlesCount,
  } = options;

  const candidates: StrategyCandidate[] = [];
  const regimeList = regimeFilters ?? [undefined];

  for (const eventType of eventTypes) {
    for (const regimeFilter of regimeList) {
      const hypothesis: Hypothesis = {
        id: `hyp-${symbol}-${timeframe}-${eventType}-${candidates.length}`,
        description: buildDescription(symbol, timeframe, eventType, regimeFilter),
        symbol,
        timeframe,
        eventType,
        targetMetric: 'hit2R',
        ...(regimeFilter !== undefined ? { regimeFilter } : {}),
        horizonCandles,
      };

      const result = testHypothesis(hypothesis, {
        candles,
        ...(trainCandlesCount !== undefined ? { trainCandlesCount } : {}),
        ...(testCandlesCount !== undefined ? { testCandlesCount } : {}),
        ...(stepCandlesCount !== undefined ? { stepCandlesCount } : {}),
      });

      // Only keep candidates that showed some signal.
      if (result.verdict === 'rejected' || result.verdict === 'insufficient_sample') {
        continue;
      }

      const candidate = buildCandidate(hypothesis, result);
      candidates.push(candidate);
    }
  }

  // Sort by robustness score descending.
  return candidates.sort((a, b) => b.robustness.score - a.robustness.score);
}

function buildDescription(
  symbol: string,
  timeframe: string,
  eventType: string,
  regimeFilter?: Partial<import('@nemesis-oss/regime-engine').CompositeRegime>,
): string {
  const parts = [`${eventType} on ${symbol} ${timeframe}`];
  if (regimeFilter?.trend) parts.push(`when trend is ${regimeFilter.trend}`);
  if (regimeFilter?.volatility) parts.push(`when volatility is ${regimeFilter.volatility}`);
  return parts.join(' ');
}

function buildCandidate(
  hypothesis: Hypothesis,
  result: HypothesisResult,
): StrategyCandidate {
  const entryConditions: Condition[] = [
    {
      field: 'eventType',
      operator: 'eq',
      value: hypothesis.eventType,
      description: `Enter on ${hypothesis.eventType} detection`,
    },
  ];

  const contextConditions: Condition[] = [];
  if (hypothesis.regimeFilter?.trend) {
    contextConditions.push({
      field: 'trendRegime',
      operator: 'eq',
      value: hypothesis.regimeFilter.trend,
      description: `Trend must be ${hypothesis.regimeFilter.trend}`,
    });
  }
  if (hypothesis.regimeFilter?.volatility) {
    contextConditions.push({
      field: 'volatilityRegime',
      operator: 'eq',
      value: hypothesis.regimeFilter.volatility,
      description: `Volatility must be ${hypothesis.regimeFilter.volatility}`,
    });
  }

  const robustness = computeRobustness(result);

  return {
    id: `strat-${hypothesis.id}`,
    hypothesis,
    result,
    entryConditions,
    contextConditions,
    invalidation: {
      type: 'stop_loss',
      parameters: { stopAtrMultiplier: 1.5 },
      description: 'Exit if price moves 1.5 ATR against entry',
    },
    targetModel: {
      targetR: 2,
      stopAtrMultiplier: 1.5,
      horizonCandles: hypothesis.horizonCandles ?? 24,
    },
    sampleSize: result.sampleSize,
    expectancyR: result.uplift * 2, // simplified
    winRate: result.reachRate,
    confidenceInterval: { lower: result.reachRate * 0.85, upper: result.reachRate * 1.15 },
    baselineComparison: { baseline: result.baselineRate, uplift: result.uplift },
    ...(result.oosReachRate !== undefined && result.oosDegradation !== undefined
      ? { oosPerformance: { reachRate: result.oosReachRate, degradation: result.oosDegradation } }
      : {}),
    robustness,
    provenance: {
      createdAt: Date.now(),
      engineVersion: '0.1.0',
    },
  };
}

function computeRobustness(result: HypothesisResult): RobustnessScore {
  const factors: string[] = [];
  let score = 0;

  // Sample size factor
  if (result.sampleSize >= 100) { score += 0.3; factors.push('large_sample'); }
  else if (result.sampleSize >= 50) { score += 0.2; factors.push('adequate_sample'); }
  else if (result.sampleSize >= 30) { score += 0.1; factors.push('minimum_sample'); }

  // Statistical significance
  if (result.isFdrSignificant) { score += 0.3; factors.push('fdr_significant'); }
  else if (result.pValue < 0.05) { score += 0.15; factors.push('nominally_significant'); }

  // OOS stability
  if (result.oosDegradation !== undefined) {
    if (result.oosDegradation < 0.05) { score += 0.3; factors.push('oos_stable'); }
    else if (result.oosDegradation < 0.1) { score += 0.15; factors.push('oos_acceptable'); }
  }

  // Uplift magnitude
  if (result.uplift > 0.1) { score += 0.1; factors.push('strong_uplift'); }

  score = Math.min(score, 1);
  const level: RobustnessLevel = score >= 0.7 ? 'high' : score >= 0.4 ? 'medium' : 'low';

  return { level, score, factors };
}
