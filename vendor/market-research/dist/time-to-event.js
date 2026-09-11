function calculatePercentile(values, p) {
    if (values.length === 0)
        return null;
    const sorted = [...values].sort((a, b) => a - b);
    const idx = Math.floor(sorted.length * p);
    return sorted[Math.min(sorted.length - 1, idx)];
}
/**
 * Computes non-parametric empirical survival curves and competing-risk time-to-event distributions.
 */
export function computeTimeToEventProfile(outcomes, maxHorizonBars = 24) {
    const sampleSize = outcomes.length;
    if (sampleSize === 0) {
        return { sampleSize: 0, medianBarsToTouch: null, medianBarsToTarget: null, medianBarsToStop: null, survivalCurve: [] };
    }
    const touchBars = [];
    const targetBars = [];
    const stopBars = [];
    for (const o of outcomes) {
        if ('firstTouchBars' in o && typeof o.firstTouchBars === 'number') {
            touchBars.push(o.firstTouchBars);
        }
        if (o.firstHit === 'target_first' && o.timeToFirstHitBars > 0) {
            targetBars.push(o.timeToFirstHitBars);
        }
        else if (o.firstHit === 'stop_first' && o.timeToFirstHitBars > 0) {
            stopBars.push(o.timeToFirstHitBars);
        }
    }
    const survivalCurve = [];
    for (let t = 1; t <= maxHorizonBars; t++) {
        // Survives = touched strictly AFTER bar t or never touched
        const surviving = outcomes.filter(o => {
            if (!('firstTouchBars' in o) || o.firstTouchBars === null)
                return true;
            return o.firstTouchBars > t;
        }).length;
        const reachedTarget = targetBars.filter(b => b <= t).length;
        const reachedStop = stopBars.filter(b => b <= t).length;
        const pTarget = reachedTarget / sampleSize;
        const pStop = reachedStop / sampleSize;
        survivalCurve.push({
            bars: t,
            survivalRate: surviving / sampleSize,
            cumulativeTargetRate: pTarget,
            cumulativeStopRate: pStop,
            cumulativeNeitherRate: Math.max(0, 1 - (pTarget + pStop))
        });
    }
    return {
        sampleSize,
        medianBarsToTouch: calculatePercentile(touchBars, 0.5),
        medianBarsToTarget: calculatePercentile(targetBars, 0.5),
        medianBarsToStop: calculatePercentile(stopBars, 0.5),
        survivalCurve
    };
}
function calculateQuantileSummary(values) {
    if (values.length === 0)
        return null;
    return {
        p10: calculatePercentile(values, 0.10) ?? 0,
        p25: calculatePercentile(values, 0.25) ?? 0,
        p50: calculatePercentile(values, 0.50) ?? 0,
        p75: calculatePercentile(values, 0.75) ?? 0,
        p90: calculatePercentile(values, 0.90) ?? 0
    };
}
/**
 * Computes non-parametric empirical excursion distributions (MFE/MAE quantiles and threshold exceedance).
 */
export function computeOutcomeDistribution(outcomes, atrThresholds = [0.5, 1.0, 1.5, 2.0, 2.5, 3.0, 4.0, 5.0]) {
    const n = outcomes.length;
    if (n === 0) {
        return {
            sampleSize: 0,
            mfeAtrQuantiles: null,
            maeAtrQuantiles: null,
            mfeDistribution: [],
            maeDistribution: []
        };
    }
    const mfeVals = outcomes.map(o => o.mfeAtr.toNumber());
    const maeVals = outcomes.map(o => o.maeAtr.toNumber());
    const mfeDistribution = atrThresholds.map(t => ({
        thresholdAtr: t,
        probabilityExceeding: outcomes.filter(o => o.mfeAtr.toNumber() >= t).length / n
    }));
    const maeDistribution = atrThresholds.map(t => ({
        thresholdAtr: t,
        probabilityExceeding: outcomes.filter(o => o.maeAtr.toNumber() >= t).length / n
    }));
    return {
        sampleSize: n,
        mfeAtrQuantiles: calculateQuantileSummary(mfeVals),
        maeAtrQuantiles: calculateQuantileSummary(maeVals),
        mfeDistribution,
        maeDistribution
    };
}
//# sourceMappingURL=time-to-event.js.map