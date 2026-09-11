/**
 * Checks if two events occurred within temporal and structural proximity (same episode / window).
 */
export function areEventsCoOccurring(eventA, eventB, maxBarGap = 3) {
    if (eventA.symbol !== eventB.symbol || eventA.timeframe !== eventB.timeframe)
        return false;
    return Math.abs(eventA.availableAtIndex - eventB.availableAtIndex) <= maxBarGap;
}
export function calculateBinaryEntropy(p) {
    if (p <= 0 || p >= 1)
        return 0;
    return -(p * Math.log2(p) + (1 - p) * Math.log2(1 - p));
}
export function calculateConditionalOddsRatio(hitsWith, totalWith, hitsWithout, totalWithout) {
    const missesWith = totalWith - hitsWith;
    const missesWithout = totalWithout - hitsWithout;
    const num = (hitsWith + 0.5) * (missesWithout + 0.5);
    const den = (missesWith + 0.5) * (hitsWithout + 0.5);
    return den === 0 ? 1.0 : num / den;
}
export function calculateInformationGain(probTotal, probWith, probWithout, weightWith) {
    const hTotal = calculateBinaryEntropy(probTotal);
    const hCond = weightWith * calculateBinaryEntropy(probWith) + (1 - weightWith) * calculateBinaryEntropy(probWithout);
    return Math.max(0, hTotal - hCond);
}
function matchesSecondaryCondition(anchor, sec, opts) {
    if (anchor.symbol !== sec.symbol || anchor.timeframe !== sec.timeframe)
        return false;
    if (opts.requireDirectionMatch && anchor.direction !== sec.direction)
        return false;
    const anchorIdx = anchor.availableAtIndex;
    const secIdx = sec.availableAtIndex;
    if (opts.requirePriorOrCoincident && secIdx > anchorIdx)
        return false;
    return Math.abs(secIdx - anchorIdx) <= (opts.maxBarGap ?? 3);
}
/**
 * Evaluates anchor-based opportunity matching and conditional interaction statistics:
 * P(Y | A, B), P(Y | A, !B), conditional uplift, conditional odds ratio, and information gain.
 */
export function analyzeAnchorInteraction(anchorObservations, secondaryEvents, options = {}) {
    const anchorType = anchorObservations[0]?.event.type ?? 'anchor';
    const secondaryType = secondaryEvents[0]?.type ?? 'secondary';
    const targetMetric = options.targetMetric ?? 'hit2R';
    const total = anchorObservations.length;
    if (total === 0) {
        return {
            anchorType, secondaryType, sampleSizeAnchor: 0, sampleSizeWithSecondary: 0, sampleSizeWithoutSecondary: 0,
            probAnchor: 0, probWithSecondary: 0, probWithoutSecondary: 0, conditionalUplift: 0,
            relativeConditionalUplift: 0, conditionalOddsRatio: 1.0, informationGain: 0, redundancyScore: 1.0, coOccurrenceRate: 0
        };
    }
    const withSecondary = anchorObservations.filter(o => secondaryEvents.some(s => matchesSecondaryCondition(o.event, s, options)));
    const withoutSecondary = anchorObservations.filter(o => !secondaryEvents.some(s => matchesSecondaryCondition(o.event, s, options)));
    const nWith = withSecondary.length;
    const nWithout = withoutSecondary.length;
    const hitsTotal = anchorObservations.filter(o => o.outcome[targetMetric]).length;
    const hitsWith = withSecondary.filter(o => o.outcome[targetMetric]).length;
    const hitsWithout = withoutSecondary.filter(o => o.outcome[targetMetric]).length;
    const probAnchor = hitsTotal / total;
    const probWith = nWith > 0 ? hitsWith / nWith : 0;
    const probWithout = nWithout > 0 ? hitsWithout / nWithout : 0;
    const conditionalUplift = probWith - probWithout;
    const relativeUplift = probWithout > 0 ? conditionalUplift / probWithout : 0;
    const oddsRatio = calculateConditionalOddsRatio(hitsWith, nWith, hitsWithout, nWithout);
    const infoGain = calculateInformationGain(probAnchor, probWith, probWithout, nWith / total);
    const redundancy = Math.max(0, Math.min(1, 1 - Math.abs(conditionalUplift) / Math.max(0.001, Math.abs(probAnchor - 0.5))));
    return {
        anchorType, secondaryType, sampleSizeAnchor: total, sampleSizeWithSecondary: nWith, sampleSizeWithoutSecondary: nWithout,
        probAnchor, probWithSecondary: probWith, probWithoutSecondary: probWithout, conditionalUplift,
        relativeConditionalUplift: relativeUplift, conditionalOddsRatio: oddsRatio, informationGain: infoGain,
        redundancyScore: redundancy, coOccurrenceRate: nWith / total
    };
}
/**
 * Evaluates the empirical interaction and incremental contribution between two event families.
 */
export function analyzeEventPairInteraction(observationsA, observationsB, targetMetric = 'hit2R', maxBarGap = 3) {
    const typeA = observationsA[0]?.event.type ?? 'A';
    const typeB = observationsB[0]?.event.type ?? 'B';
    const probA = observationsA.length > 0
        ? observationsA.filter(o => o.outcome[targetMetric]).length / observationsA.length
        : 0;
    const probB = observationsB.length > 0
        ? observationsB.filter(o => o.outcome[targetMetric]).length / observationsB.length
        : 0;
    // Find co-occurring instances
    const combinedOutcomes = observationsA.filter(obsA => observationsB.some(obsB => areEventsCoOccurring(obsA.event, obsB.event, maxBarGap)));
    const sampleCombined = combinedOutcomes.length;
    const probCombined = sampleCombined > 0
        ? combinedOutcomes.filter(o => o.outcome[targetMetric]).length / sampleCombined
        : 0;
    const interactionUplift = probCombined - Math.max(probA, probB);
    const incrementalA = probCombined - probB;
    const incrementalB = probCombined - probA;
    // Redundancy: 1.0 means B adds zero edge beyond A
    const maxSoloEdge = Math.max(0.0001, probB - 0.5);
    const redundancy = Math.max(0, Math.min(1, 1 - (incrementalB / maxSoloEdge)));
    return {
        primaryType: typeA,
        secondaryType: typeB,
        sampleSizePrimary: observationsA.length,
        sampleSizeSecondary: observationsB.length,
        sampleSizeCombined: sampleCombined,
        probPrimary: probA,
        probSecondary: probB,
        probCombined,
        interactionUplift,
        incrementalContributionPrimary: incrementalA,
        incrementalContributionSecondary: incrementalB,
        redundancyScore: redundancy
    };
}
//# sourceMappingURL=interactions.js.map