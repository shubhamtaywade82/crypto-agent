import { runObservationStudy, evaluateNegativeEvidenceImpact, } from '@nemesis-oss/market-research';
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
export function computeEvidenceBalance(options) {
    const { candles, symbol, timeframe, eventType, htf = '1h', horizonCandles = 24, } = options;
    const study = runObservationStudy(candles, {
        symbol,
        timeframe,
        horizonCandles,
    });
    const componentResult = study.results.find((r) => r.eventType === eventType);
    const observations = study.observations.filter((o) => o.event.type === eventType);
    const positive = [];
    const negative = [];
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
            return o.outcome.isInvalidated;
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
    const recommendation = netScore > 0.05 ? 'proceed'
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
function addNegativeItems(negative, impact, htf) {
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
//# sourceMappingURL=balance.js.map