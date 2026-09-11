import type { Timeframe } from '@nemesis-oss/market-events';
import type { ResearchObservation } from './types.js';
export type ConditionScope = 'predictive' | 'outcome';
export interface ConditionExpression<Scope extends ConditionScope = ConditionScope> {
    readonly type: 'all' | 'any' | 'not' | 'comparison' | 'custom';
    readonly scope: Scope;
    readonly description: string;
    readonly evaluate: (obs: ResearchObservation) => boolean;
}
export type PredictiveCondition = ConditionExpression<'predictive'>;
export type OutcomeCondition = ConditionExpression<'outcome'>;
export declare function all<S extends ConditionScope = 'predictive'>(...conditions: readonly ConditionExpression<S>[]): ConditionExpression<S>;
export declare function any<S extends ConditionScope = 'predictive'>(...conditions: readonly ConditionExpression<S>[]): ConditionExpression<S>;
export declare function not<S extends ConditionScope = 'predictive'>(condition: ConditionExpression<S>): ConditionExpression<S>;
export interface StringFeatureBuilder<S extends ConditionScope = 'predictive'> {
    readonly eq: (val: string) => ConditionExpression<S>;
    readonly neq: (val: string) => ConditionExpression<S>;
    readonly in: (vals: readonly string[]) => ConditionExpression<S>;
}
export interface NumberFeatureBuilder<S extends ConditionScope = 'predictive'> {
    readonly eq: (val: number) => ConditionExpression<S>;
    readonly gt: (val: number) => ConditionExpression<S>;
    readonly gte: (val: number) => ConditionExpression<S>;
    readonly lt: (val: number) => ConditionExpression<S>;
    readonly lte: (val: number) => ConditionExpression<S>;
}
export type ContextStringFeature = 'trendRegime' | 'volatilityRegime' | 'session' | 'direction' | 'eventType';
export type ContextNumericFeature = 'atr';
export type ContextFeatureName = ContextStringFeature | ContextNumericFeature;
export type OutcomeNumericFeature = 'mfeAtr' | 'maeAtr';
export type OutcomeFeatureName = OutcomeNumericFeature;
/**
 * Builds conditions on predictive context features (available at observation time, zero outcome leakage).
 */
export declare function contextFeature(name: ContextStringFeature): StringFeatureBuilder<'predictive'>;
export declare function contextFeature(name: ContextNumericFeature): NumberFeatureBuilder<'predictive'>;
/**
 * Builds conditions on ex-post outcome metrics for outcome-stratification analysis only.
 */
export declare function outcomeFeature(name: OutcomeNumericFeature): NumberFeatureBuilder<'outcome'>;
export declare function feature(name: ContextStringFeature): StringFeatureBuilder<'predictive'>;
export declare function feature(name: ContextNumericFeature): NumberFeatureBuilder<'predictive'>;
export declare function htfTrend(tf: Timeframe): StringFeatureBuilder<'predictive'>;
export interface ConditionEvaluationResult {
    readonly description: string;
    readonly totalObservations: number;
    readonly matchedObservations: number;
    readonly matchRate: number;
    readonly conditionedHitRateR2: number;
    readonly unconditionedHitRateR2: number;
    readonly upliftR2: number;
}
export declare function evaluateCondition(observations: readonly ResearchObservation[], condition: PredictiveCondition): ConditionEvaluationResult;
//# sourceMappingURL=condition-engine.d.ts.map