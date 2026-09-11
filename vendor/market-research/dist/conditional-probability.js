import { calculateWilsonInterval } from './statistical-significance.js';
/**
 * Calculates empirical conditional probability and edge uplift with rigorous ratio metrics:
 * P(target | Condition) vs P(target | Base Population)
 */
export function calculateConditionalEdge(observations, conditionFilter, targetMetric = 'hit2R') {
    const zeroCi = { lower: 0, upper: 0, confidenceLevel: 0.95 };
    if (observations.length === 0) {
        return {
            targetOutcome: targetMetric,
            baseProbability: 0,
            conditionedProbability: 0,
            uplift: 0,
            absoluteUplift: 0,
            relativeUplift: 0,
            oddsRatio: 1,
            riskRatio: 1,
            sampleSize: 0,
            baselineSampleSize: 0,
            confidenceInterval: zeroCi
        };
    }
    const baseHits = observations.filter(o => o.outcome[targetMetric]).length;
    const baseProb = baseHits / observations.length;
    const conditioned = observations.filter(conditionFilter);
    if (conditioned.length === 0) {
        return {
            targetOutcome: targetMetric,
            baseProbability: baseProb,
            conditionedProbability: 0,
            uplift: -baseProb,
            absoluteUplift: -baseProb,
            relativeUplift: -1,
            oddsRatio: 0,
            riskRatio: 0,
            sampleSize: 0,
            baselineSampleSize: observations.length,
            confidenceInterval: zeroCi
        };
    }
    const condHits = conditioned.filter(o => o.outcome[targetMetric]).length;
    const condProb = condHits / conditioned.length;
    const absUplift = condProb - baseProb;
    const relUplift = baseProb > 0 ? absUplift / baseProb : 0;
    const riskRatio = baseProb > 0 ? condProb / baseProb : 1;
    const odds1 = condProb >= 1 ? 999 : condProb / Math.max(0.0001, 1 - condProb);
    const odds2 = baseProb >= 1 ? 999 : baseProb / Math.max(0.0001, 1 - baseProb);
    const oddsRatio = odds2 > 0 ? odds1 / odds2 : 1;
    const ci = calculateWilsonInterval(condHits, conditioned.length);
    return {
        targetOutcome: targetMetric,
        baseProbability: baseProb,
        conditionedProbability: condProb,
        uplift: absUplift,
        absoluteUplift: absUplift,
        relativeUplift: relUplift,
        oddsRatio,
        riskRatio,
        sampleSize: conditioned.length,
        baselineSampleSize: observations.length,
        confidenceInterval: ci
    };
}
//# sourceMappingURL=conditional-probability.js.map