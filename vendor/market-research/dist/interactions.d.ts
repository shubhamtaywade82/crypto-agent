import type { BaseEvent } from '@nemesis-oss/market-events';
import type { EventOutcome } from './types.js';
export interface EventObservation {
    readonly event: BaseEvent;
    readonly outcome: EventOutcome;
}
export interface InteractionPairAnalysis {
    readonly primaryType: string;
    readonly secondaryType: string;
    readonly sampleSizePrimary: number;
    readonly sampleSizeSecondary: number;
    readonly sampleSizeCombined: number;
    readonly probPrimary: number;
    readonly probSecondary: number;
    readonly probCombined: number;
    readonly interactionUplift: number;
    readonly incrementalContributionPrimary: number;
    readonly incrementalContributionSecondary: number;
    readonly redundancyScore: number;
}
export interface AnchorInteractionOptions {
    readonly maxBarGap?: number | undefined;
    readonly targetMetric?: 'hit1R' | 'hit2R' | 'hit3R' | undefined;
    readonly requireDirectionMatch?: boolean | undefined;
    readonly requirePriorOrCoincident?: boolean | undefined;
}
export interface ConditionalInteractionResult {
    readonly anchorType: string;
    readonly secondaryType: string;
    readonly sampleSizeAnchor: number;
    readonly sampleSizeWithSecondary: number;
    readonly sampleSizeWithoutSecondary: number;
    readonly probAnchor: number;
    readonly probWithSecondary: number;
    readonly probWithoutSecondary: number;
    readonly conditionalUplift: number;
    readonly relativeConditionalUplift: number;
    readonly conditionalOddsRatio: number;
    readonly informationGain: number;
    readonly redundancyScore: number;
    readonly coOccurrenceRate: number;
}
/**
 * Checks if two events occurred within temporal and structural proximity (same episode / window).
 */
export declare function areEventsCoOccurring(eventA: BaseEvent, eventB: BaseEvent, maxBarGap?: number): boolean;
export declare function calculateBinaryEntropy(p: number): number;
export declare function calculateConditionalOddsRatio(hitsWith: number, totalWith: number, hitsWithout: number, totalWithout: number): number;
export declare function calculateInformationGain(probTotal: number, probWith: number, probWithout: number, weightWith: number): number;
/**
 * Evaluates anchor-based opportunity matching and conditional interaction statistics:
 * P(Y | A, B), P(Y | A, !B), conditional uplift, conditional odds ratio, and information gain.
 */
export declare function analyzeAnchorInteraction(anchorObservations: readonly EventObservation[], secondaryEvents: readonly BaseEvent[], options?: AnchorInteractionOptions): ConditionalInteractionResult;
/**
 * Evaluates the empirical interaction and incremental contribution between two event families.
 */
export declare function analyzeEventPairInteraction(observationsA: readonly EventObservation[], observationsB: readonly EventObservation[], targetMetric?: 'hit1R' | 'hit2R' | 'hit3R', maxBarGap?: number): InteractionPairAnalysis;
//# sourceMappingURL=interactions.d.ts.map