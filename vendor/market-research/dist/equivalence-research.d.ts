import type { BaseEvent, MarketEvent } from '@nemesis-oss/market-events';
import type { ResearchObservation } from './types.js';
export type CanonicalBehaviorType = 'FAILED_DOWNSIDE_AUCTION' | 'FAILED_UPSIDE_AUCTION' | 'AGGRESSIVE_DIRECTIONAL_EXPANSION' | 'LIQUIDITY_IMBALANCE';
export interface CanonicalMapping {
    readonly canonicalType: CanonicalBehaviorType;
    readonly matchedEvents: readonly BaseEvent[];
    readonly representations: readonly string[];
    readonly timestamp: number;
}
export declare function mapToCanonicalEquivalence(events: readonly (BaseEvent | MarketEvent)[]): CanonicalMapping[];
export type EquivalenceConclusion = 'equivalent' | 'non-equivalent' | 'inconclusive';
export interface BehavioralEquivalenceResult {
    readonly sampleSizeA: number;
    readonly sampleSizeB: number;
    readonly hitRateA: number;
    readonly hitRateB: number;
    readonly absoluteDifference: number;
    readonly zScore: number;
    readonly pValue: number;
    readonly tostPValue: number;
    readonly tostZ1: number;
    readonly tostZ2: number;
    readonly confidenceInterval90: {
        readonly lower: number;
        readonly upper: number;
    };
    readonly isBehaviorallyEquivalent: boolean;
    readonly equivalenceMargin: number;
    readonly conclusion: EquivalenceConclusion;
}
export declare function calculateTost(pA: number, nA: number, pB: number, nB: number, delta: number): {
    z1: number;
    z2: number;
    tostPValue: number;
    se: number;
};
export type EquivalenceMetric = 'reached1R' | 'reached2R' | 'reached3R' | 'hit1R' | 'hit2R' | 'hit3R';
/**
 * Formal Two One-Sided Tests (TOST) for behavioral equivalence between event families.
 * Categorizes findings into: equivalent, non-equivalent, or inconclusive.
 */
export declare function testOutcomeEquivalence(observationsA: readonly ResearchObservation[], observationsB: readonly ResearchObservation[], targetMetric?: EquivalenceMetric, equivalenceMargin?: number, alpha?: number): BehavioralEquivalenceResult;
//# sourceMappingURL=equivalence-research.d.ts.map