import type { Timeframe } from '@nemesis-oss/market-events';
import type { ContextSnapshot, ResearchObservation } from './types.js';

export type ConditionScope = 'predictive' | 'outcome';

export interface ConditionExpression<Scope extends ConditionScope = ConditionScope> {
  readonly type: 'all' | 'any' | 'not' | 'comparison' | 'custom';
  readonly scope: Scope;
  readonly description: string;
  readonly evaluate: (obs: ResearchObservation) => boolean;
}

export type PredictiveCondition = ConditionExpression<'predictive'>;
export type OutcomeCondition = ConditionExpression<'outcome'>;

export function all<S extends ConditionScope = 'predictive'>(...conditions: readonly ConditionExpression<S>[]): ConditionExpression<S> {
  return {
    type: 'all',
    scope: (conditions[0]?.scope ?? 'predictive') as S,
    description: conditions.map(c => c.description).join(' AND '),
    evaluate: obs => conditions.every(c => c.evaluate(obs))
  };
}

export function any<S extends ConditionScope = 'predictive'>(...conditions: readonly ConditionExpression<S>[]): ConditionExpression<S> {
  return {
    type: 'any',
    scope: (conditions[0]?.scope ?? 'predictive') as S,
    description: `(${conditions.map(c => c.description).join(' OR ')})`,
    evaluate: obs => conditions.some(c => c.evaluate(obs))
  };
}

export function not<S extends ConditionScope = 'predictive'>(condition: ConditionExpression<S>): ConditionExpression<S> {
  return {
    type: 'not',
    scope: condition.scope,
    description: `NOT(${condition.description})`,
    evaluate: obs => !condition.evaluate(obs)
  };
}

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

function extractFeatureValue(obs: ResearchObservation, name: string): string | number | undefined {
  if (name === 'trendRegime') return obs.context.trendRegime;
  if (name === 'volatilityRegime') return obs.context.volatilityRegime;
  if (name === 'session') return obs.context.session ?? 'off_hours';
  if (name === 'direction') return obs.event.direction;
  if (name === 'eventType') return obs.event.type;
  if (name === 'atr') return obs.context.atr.toNumber();
  if (name === 'mfeAtr') return obs.outcome.mfeAtr.toNumber();
  if (name === 'maeAtr') return obs.outcome.maeAtr.toNumber();
  return undefined;
}

export type ContextStringFeature = 'trendRegime' | 'volatilityRegime' | 'session' | 'direction' | 'eventType';
export type ContextNumericFeature = 'atr';
export type ContextFeatureName = ContextStringFeature | ContextNumericFeature;

export type OutcomeNumericFeature = 'mfeAtr' | 'maeAtr';
export type OutcomeFeatureName = OutcomeNumericFeature;

function createNumericFeatureBuilder<S extends ConditionScope>(name: string, scope: S): NumberFeatureBuilder<S> {
  return {
    eq: (val: number): ConditionExpression<S> => ({ type: 'comparison', scope, description: `${name} == ${val}`, evaluate: (o: ResearchObservation) => Number(extractFeatureValue(o, name)) === val }),
    gt: (val: number): ConditionExpression<S> => ({ type: 'comparison', scope, description: `${name} > ${val}`, evaluate: (o: ResearchObservation) => Number(extractFeatureValue(o, name)) > val }),
    gte: (val: number): ConditionExpression<S> => ({ type: 'comparison', scope, description: `${name} >= ${val}`, evaluate: (o: ResearchObservation) => Number(extractFeatureValue(o, name)) >= val }),
    lt: (val: number): ConditionExpression<S> => ({ type: 'comparison', scope, description: `${name} < ${val}`, evaluate: (o: ResearchObservation) => Number(extractFeatureValue(o, name)) < val }),
    lte: (val: number): ConditionExpression<S> => ({ type: 'comparison', scope, description: `${name} <= ${val}`, evaluate: (o: ResearchObservation) => Number(extractFeatureValue(o, name)) <= val })
  };
}

function createStringFeatureBuilder<S extends ConditionScope>(name: string, scope: S): StringFeatureBuilder<S> {
  return {
    eq: (val: string): ConditionExpression<S> => ({ type: 'comparison', scope, description: `${name} == '${val}'`, evaluate: (o: ResearchObservation) => String(extractFeatureValue(o, name)) === val }),
    neq: (val: string): ConditionExpression<S> => ({ type: 'comparison', scope, description: `${name} != '${val}'`, evaluate: (o: ResearchObservation) => String(extractFeatureValue(o, name)) !== val }),
    in: (vals: readonly string[]): ConditionExpression<S> => ({
      type: 'comparison',
      scope,
      description: `${name} IN [${vals.join(', ')}]`,
      evaluate: (o: ResearchObservation) => vals.includes(String(extractFeatureValue(o, name)))
    })
  };
}

/**
 * Builds conditions on predictive context features (available at observation time, zero outcome leakage).
 */
export function contextFeature(name: ContextStringFeature): StringFeatureBuilder<'predictive'>;
export function contextFeature(name: ContextNumericFeature): NumberFeatureBuilder<'predictive'>;
export function contextFeature(name: ContextFeatureName): StringFeatureBuilder<'predictive'> | NumberFeatureBuilder<'predictive'> {
  return name === 'atr' ? createNumericFeatureBuilder(name, 'predictive') : createStringFeatureBuilder(name, 'predictive');
}

/**
 * Builds conditions on ex-post outcome metrics for outcome-stratification analysis only.
 */
export function outcomeFeature(name: OutcomeNumericFeature): NumberFeatureBuilder<'outcome'> {
  return createNumericFeatureBuilder(name, 'outcome');
}

export function feature(name: ContextStringFeature): StringFeatureBuilder<'predictive'>;
export function feature(name: ContextNumericFeature): NumberFeatureBuilder<'predictive'>;
export function feature(name: ContextFeatureName): StringFeatureBuilder<'predictive'> | NumberFeatureBuilder<'predictive'> {
  return contextFeature(name as ContextStringFeature);
}

export function htfTrend(tf: Timeframe): StringFeatureBuilder<'predictive'> {
  const getTrend = (c: ContextSnapshot) => c.htfContext?.[tf]?.trend ?? 'sideways';
  return {
    eq: (val: string): ConditionExpression<'predictive'> => ({ type: 'comparison', scope: 'predictive', description: `htfTrend(${tf}) == '${val}'`, evaluate: (o: ResearchObservation) => getTrend(o.context) === val }),
    neq: (val: string): ConditionExpression<'predictive'> => ({ type: 'comparison', scope: 'predictive', description: `htfTrend(${tf}) != '${val}'`, evaluate: (o: ResearchObservation) => getTrend(o.context) !== val }),
    in: (vals: readonly string[]): ConditionExpression<'predictive'> => ({
      type: 'comparison',
      scope: 'predictive',
      description: `htfTrend(${tf}) IN [${vals.join(', ')}]`,
      evaluate: (o: ResearchObservation) => vals.includes(getTrend(o.context))
    })
  };
}

export interface ConditionEvaluationResult {
  readonly description: string;
  readonly totalObservations: number;
  readonly matchedObservations: number;
  readonly matchRate: number;
  readonly conditionedHitRateR2: number;
  readonly unconditionedHitRateR2: number;
  readonly upliftR2: number;
}

export function evaluateCondition(
  observations: readonly ResearchObservation[],
  condition: PredictiveCondition
): ConditionEvaluationResult {
  const total = observations.length;
  if (total === 0) {
    return {
      description: condition.description, totalObservations: 0, matchedObservations: 0,
      matchRate: 0, conditionedHitRateR2: 0, unconditionedHitRateR2: 0, upliftR2: 0
    };
  }

  const baseHitR2 = observations.filter(o => o.outcome.hit2R).length / total;
  const matched = observations.filter(o => condition.evaluate(o));
  const condHitR2 = matched.length > 0 ? matched.filter(o => o.outcome.hit2R).length / matched.length : 0;

  return {
    description: condition.description,
    totalObservations: total,
    matchedObservations: matched.length,
    matchRate: matched.length / total,
    conditionedHitRateR2: condHitR2,
    unconditionedHitRateR2: baseHitR2,
    upliftR2: condHitR2 - baseHitR2
  };
}
