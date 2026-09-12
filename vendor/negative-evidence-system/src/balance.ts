import type { Candle, Timeframe, BaseEvent } from '@nemesis-oss/market-events';
import {
  detectSwings,
  detectFvg,
  detectBos,
  detectChoch,
  detectMss,
  detectStructureBreaks,
  detectOrderBlocks,
  detectLiquiditySweeps,
  detectDisplacement,
} from '@nemesis-oss/market-events';
import {
  runObservationStudy,
  evaluateNegativeEvidenceImpact,
  type NegativeEvidenceImpactResult,
  type ResearchObservation,
} from '@nemesis-oss/market-research';

/**
 * A single piece of evidence — either positive or negative.
 */
export interface EvidenceItem {
  readonly label: string;
  readonly magnitude: number; // positive number; sign is in `direction`
  readonly direction: 'positive' | 'negative';
  readonly source: string; // e.g. "baseline_uplift", "htf_conflict", "early_failure"
  readonly description: string;
}

/**
 * The evidence balance for a strategy/hypothesis.
 *
 * Combines the positive edge (uplift over baseline) with the negative
 * evidence (HTF conflict, early failure, invalidated zones) to produce
 * a net evidence score.
 *
 * Example:
 *   FVG strategy
 *   Positive: +12% relative uplift
 *   Negative: -18% during high volatility
 *            -11% with HTF conflict
 *            -9% after liquidity sweep failure
 *   Net: -26% (strategy is net negative when accounting for negative evidence)
 */
export interface EvidenceBalance {
  readonly strategy: string;
  readonly symbol: string;
  readonly timeframe: string;
  readonly eventType: string;
  readonly positiveEvidence: readonly EvidenceItem[];
  readonly negativeEvidence: readonly EvidenceItem[];
  readonly netScore: number;
  readonly recommendation: 'proceed' | 'caution' | 'reject';
  readonly computedAt: number;
}

export interface EvidenceBalanceOptions {
  readonly candles: readonly Candle[];
  readonly symbol: string;
  readonly timeframe: Timeframe;
  readonly eventType: string;
  readonly htf?: Timeframe;
  readonly horizonCandles?: number;
}

/**
 * Compute the evidence balance for a strategy.
 *
 * Combines:
 *  - Positive: baseline uplift, FDR significance, OOS stability
 *  - Negative: HTF conflict penalty, early failure rate, invalidated zone rate
 *
 * The net score is the sum of all positive and negative items.
 * A positive net score → 'proceed'; near zero → 'caution'; negative → 'reject'.
 */
export function computeEvidenceBalance(
  options: EvidenceBalanceOptions,
): EvidenceBalance {
  const {
    candles,
    symbol,
    timeframe,
    eventType,
    htf = '1h',
    horizonCandles = 24,
  } = options;

  const study = runObservationStudy(candles, {
    symbol,
    timeframe,
    horizonCandles,
  });

  const componentResult = study.results.find((r) => r.eventType === eventType);
  const observations = study.observations.filter((o) => o.event.type === eventType);

  const positive: EvidenceItem[] = [];
  const negative: EvidenceItem[] = [];

  // --- Positive evidence ---
  if (componentResult?.baselineComparisonR2) {
    const bc = componentResult.baselineComparisonR2;
    if (bc.uplift > 0) {
      positive.push({
        label: 'baseline_uplift',
        magnitude: bc.uplift,
        direction: 'positive',
        source: 'matched_controls',
        description: `+${(bc.uplift * 100).toFixed(1)}pp uplift over matched baseline`,
      });
    }
    if (bc.isFdrSignificant) {
      positive.push({
        label: 'fdr_significant',
        magnitude: 0.05,
        direction: 'positive',
        source: 'multiple_testing',
        description: 'Survives Benjamini-Hochberg FDR correction',
      });
    }
    if (bc.oddsRatio && bc.oddsRatio > 1) {
      positive.push({
        label: 'odds_ratio',
        magnitude: bc.oddsRatio - 1,
        direction: 'positive',
        source: 'statistical_significance',
        description: `Odds ratio ${bc.oddsRatio.toFixed(2)} (>1 favors event)`,
      });
    }
  }

  // --- Negative evidence ---
  if (observations.length > 0) {
    const impact = evaluateNegativeEvidenceImpact(observations, htf);
    addNegativeItems(negative, impact, htf);
  }

  // Invalidated zones (FVG-specific)
  const invalidated = observations.filter((o) => {
    if ('isInvalidated' in o.outcome) {
      return (o.outcome as { isInvalidated: boolean }).isInvalidated;
    }
    return false;
  });
  if (invalidated.length > 0 && observations.length > 0) {
    const rate = invalidated.length / observations.length;
    negative.push({
      label: 'invalidated_zone_rate',
      magnitude: rate,
      direction: 'negative',
      source: 'zone_invalidation',
      description: `${(rate * 100).toFixed(1)}% of zones invalidated`,
    });
  }

  // Compute net score
  const positiveSum = positive.reduce((s, e) => s + e.magnitude, 0);
  const negativeSum = negative.reduce((s, e) => s + e.magnitude, 0);
  const netScore = positiveSum - negativeSum;

  const recommendation: EvidenceBalance['recommendation'] =
    netScore > 0.05 ? 'proceed'
    : netScore > -0.05 ? 'caution'
    : 'reject';

  return {
    strategy: `${eventType} on ${symbol} ${timeframe}`,
    symbol,
    timeframe,
    eventType,
    positiveEvidence: positive,
    negativeEvidence: negative,
    netScore,
    recommendation,
    computedAt: Date.now(),
  };
}

function addNegativeItems(
  negative: EvidenceItem[],
  impact: NegativeEvidenceImpactResult,
  htf: Timeframe,
): void {
  if (impact.conflictPenalty < 0) {
    negative.push({
      label: 'htf_conflict',
      magnitude: Math.abs(impact.conflictPenalty),
      direction: 'negative',
      source: 'htf_conflict_analysis',
      description: `${(impact.conflictPenalty * 100).toFixed(1)}pp penalty from ${htf} conflict`,
    });
  }
  if (impact.earlyFailureRate > 0) {
    negative.push({
      label: 'early_failure',
      magnitude: impact.earlyFailureRate,
      direction: 'negative',
      source: 'early_failure_analysis',
      description: `${(impact.earlyFailureRate * 100).toFixed(1)}% of events fail within 3 bars`,
    });
  }
  if (impact.netEvidenceScore < 0) {
    negative.push({
      label: 'net_evidence_score',
      magnitude: Math.abs(impact.netEvidenceScore),
      direction: 'negative',
      source: 'combined_evidence',
      description: `Net evidence score: ${impact.netEvidenceScore.toFixed(2)}`,
    });
  }
}
