export function all(...conditions) {
    return {
        type: 'all',
        scope: (conditions[0]?.scope ?? 'predictive'),
        description: conditions.map(c => c.description).join(' AND '),
        evaluate: obs => conditions.every(c => c.evaluate(obs))
    };
}
export function any(...conditions) {
    return {
        type: 'any',
        scope: (conditions[0]?.scope ?? 'predictive'),
        description: `(${conditions.map(c => c.description).join(' OR ')})`,
        evaluate: obs => conditions.some(c => c.evaluate(obs))
    };
}
export function not(condition) {
    return {
        type: 'not',
        scope: condition.scope,
        description: `NOT(${condition.description})`,
        evaluate: obs => !condition.evaluate(obs)
    };
}
function extractFeatureValue(obs, name) {
    if (name === 'trendRegime')
        return obs.context.trendRegime;
    if (name === 'volatilityRegime')
        return obs.context.volatilityRegime;
    if (name === 'session')
        return obs.context.session ?? 'off_hours';
    if (name === 'direction')
        return obs.event.direction;
    if (name === 'eventType')
        return obs.event.type;
    if (name === 'atr')
        return obs.context.atr.toNumber();
    if (name === 'mfeAtr')
        return obs.outcome.mfeAtr.toNumber();
    if (name === 'maeAtr')
        return obs.outcome.maeAtr.toNumber();
    return undefined;
}
function createNumericFeatureBuilder(name, scope) {
    return {
        eq: (val) => ({ type: 'comparison', scope, description: `${name} == ${val}`, evaluate: (o) => Number(extractFeatureValue(o, name)) === val }),
        gt: (val) => ({ type: 'comparison', scope, description: `${name} > ${val}`, evaluate: (o) => Number(extractFeatureValue(o, name)) > val }),
        gte: (val) => ({ type: 'comparison', scope, description: `${name} >= ${val}`, evaluate: (o) => Number(extractFeatureValue(o, name)) >= val }),
        lt: (val) => ({ type: 'comparison', scope, description: `${name} < ${val}`, evaluate: (o) => Number(extractFeatureValue(o, name)) < val }),
        lte: (val) => ({ type: 'comparison', scope, description: `${name} <= ${val}`, evaluate: (o) => Number(extractFeatureValue(o, name)) <= val })
    };
}
function createStringFeatureBuilder(name, scope) {
    return {
        eq: (val) => ({ type: 'comparison', scope, description: `${name} == '${val}'`, evaluate: (o) => String(extractFeatureValue(o, name)) === val }),
        neq: (val) => ({ type: 'comparison', scope, description: `${name} != '${val}'`, evaluate: (o) => String(extractFeatureValue(o, name)) !== val }),
        in: (vals) => ({
            type: 'comparison',
            scope,
            description: `${name} IN [${vals.join(', ')}]`,
            evaluate: (o) => vals.includes(String(extractFeatureValue(o, name)))
        })
    };
}
export function contextFeature(name) {
    return name === 'atr' ? createNumericFeatureBuilder(name, 'predictive') : createStringFeatureBuilder(name, 'predictive');
}
/**
 * Builds conditions on ex-post outcome metrics for outcome-stratification analysis only.
 */
export function outcomeFeature(name) {
    return createNumericFeatureBuilder(name, 'outcome');
}
export function feature(name) {
    return contextFeature(name);
}
export function htfTrend(tf) {
    const getTrend = (c) => c.htfContext?.[tf]?.trend ?? 'sideways';
    return {
        eq: (val) => ({ type: 'comparison', scope: 'predictive', description: `htfTrend(${tf}) == '${val}'`, evaluate: (o) => getTrend(o.context) === val }),
        neq: (val) => ({ type: 'comparison', scope: 'predictive', description: `htfTrend(${tf}) != '${val}'`, evaluate: (o) => getTrend(o.context) !== val }),
        in: (vals) => ({
            type: 'comparison',
            scope: 'predictive',
            description: `htfTrend(${tf}) IN [${vals.join(', ')}]`,
            evaluate: (o) => vals.includes(getTrend(o.context))
        })
    };
}
export function evaluateCondition(observations, condition) {
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
//# sourceMappingURL=condition-engine.js.map