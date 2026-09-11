import type { BaseEvent } from '@nemesis-oss/market-events';
import type { EventOutcome } from './types.js';
import { type ConfidenceInterval } from './statistical-significance.js';
export interface EventWithOutcome {
    readonly event: BaseEvent;
    readonly outcome: EventOutcome;
}
export interface ConditionalEdgeReport {
    readonly targetOutcome: string;
    readonly baseProbability: number;
    readonly conditionedProbability: number;
    readonly uplift: number;
    readonly absoluteUplift: number;
    readonly relativeUplift: number;
    readonly oddsRatio: number;
    readonly riskRatio: number;
    readonly sampleSize: number;
    readonly baselineSampleSize: number;
    readonly confidenceInterval: ConfidenceInterval;
    readonly effectiveSampleSize?: number | undefined;
    readonly clusterCount?: number | undefined;
}
/**
 * Calculates empirical conditional probability and edge uplift with rigorous ratio metrics:
 * P(target | Condition) vs P(target | Base Population)
 */
export declare function calculateConditionalEdge(observations: readonly EventWithOutcome[], conditionFilter: (obs: EventWithOutcome) => boolean, targetMetric?: 'hit1R' | 'hit2R' | 'hit3R'): ConditionalEdgeReport;
//# sourceMappingURL=conditional-probability.d.ts.map