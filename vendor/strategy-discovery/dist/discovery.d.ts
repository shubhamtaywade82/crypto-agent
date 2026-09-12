import type { Candle, Timeframe } from '@nemesis-oss/market-events';
import { type Hypothesis, type HypothesisResult } from '@nemesis-oss/hypothesis-engine';
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
    readonly confidenceInterval: {
        readonly lower: number;
        readonly upper: number;
    };
    readonly baselineComparison: {
        readonly baseline: number;
        readonly uplift: number;
    };
    readonly oosPerformance?: {
        readonly reachRate: number;
        readonly degradation: number;
    } | undefined;
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
    readonly score: number;
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
export declare function discoverStrategies(options: StrategyDiscoveryOptions): readonly StrategyCandidate[];
//# sourceMappingURL=discovery.d.ts.map