import { Decimal } from 'decimal.js';
export const DEFAULT_OUTCOME_CONFIG = {
    horizonCandles: 24,
    targetR: 2.0,
    stopAtrMultiplier: 1.0,
    ambiguityPolicy: 'pessimistic'
};
export function resolveCollision(policy) {
    if (policy === 'optimistic')
        return 'target_first';
    if (policy === 'pessimistic')
        return 'stop_first';
    return 'simultaneous_collision';
}
function checkBarHit(c, isBull, target, stop) {
    return {
        hitTarget: isBull ? c.high.gte(target) : c.low.lte(target),
        hitStop: isBull ? c.low.lte(stop) : c.high.gte(stop)
    };
}
function resolveIntrabarPath(ltfCandles, barStart, barEnd, isBull, target, stop) {
    const windowCandles = ltfCandles.filter(c => c.timestamp >= barStart && c.timestamp < barEnd);
    for (const c of windowCandles) {
        const hitTarget = isBull ? c.high.gte(target) : c.low.lte(target);
        const hitStop = isBull ? c.low.lte(stop) : c.high.gte(stop);
        if (hitTarget && !hitStop)
            return { hit: 'target_first', resolved: true };
        if (hitStop && !hitTarget)
            return { hit: 'stop_first', resolved: true };
    }
    return { hit: 'simultaneous_collision', resolved: false };
}
export function evaluateTrajectory(candles, params) {
    const { entry, direction, atr, config, startOffset = 1 } = params;
    const isBull = direction === 'bullish';
    const target = isBull ? entry.plus(atr.times(config.targetR)) : entry.minus(atr.times(config.targetR));
    const stop = isBull ? entry.minus(atr.times(config.stopAtrMultiplier)) : entry.plus(atr.times(config.stopAtrMultiplier));
    let mfe = new Decimal(0), mae = new Decimal(0), timeToHit = 0;
    let firstHit = 'horizon_expired';
    let isAmbiguous = false, collision = false, stopHit = false;
    let pathResolution = 'ohlc_resolved';
    let timeToTarget = null, timeToStop = null;
    let timeTo1R = null, timeTo2R = null, timeTo3R = null;
    const horizon = Math.min(candles.length, startOffset + config.horizonCandles);
    for (let i = startOffset; i < horizon; i++) {
        const c = candles[i];
        const offset = i - startOffset + 1;
        const fav = isBull ? c.high.minus(entry) : entry.minus(c.low);
        if (fav.gt(mfe))
            mfe = fav;
        const adv = isBull ? entry.minus(c.low) : c.high.minus(entry);
        if (adv.gt(mae))
            mae = adv;
        const favAtr = atr.gt(0) ? fav.dividedBy(atr) : new Decimal(0);
        if (favAtr.gte(1) && timeTo1R === null)
            timeTo1R = offset;
        if (favAtr.gte(2) && timeTo2R === null)
            timeTo2R = offset;
        if (favAtr.gte(3) && timeTo3R === null)
            timeTo3R = offset;
        const { hitTarget, hitStop } = checkBarHit(c, isBull, target, stop);
        if (hitStop && !stopHit) {
            stopHit = true;
            timeToStop = offset;
        }
        if (hitTarget && timeToTarget === null)
            timeToTarget = offset;
        if (hitTarget && hitStop) {
            const barEnd = candles[i + 1]?.timestamp ?? (c.timestamp + 3600000);
            let resolved = false;
            if (params.lowerTfCandles && params.lowerTfCandles.length > 0) {
                const ltf = resolveIntrabarPath(params.lowerTfCandles, c.timestamp, barEnd, isBull, target, stop);
                if (ltf.resolved) {
                    firstHit = ltf.hit;
                    pathResolution = 'lower_tf_resolved';
                    resolved = true;
                }
            }
            if (!resolved) {
                collision = true;
                isAmbiguous = true;
                firstHit = resolveCollision(config.ambiguityPolicy);
                pathResolution = config.ambiguityPolicy === 'optimistic' ? 'ohlc_optimistic'
                    : config.ambiguityPolicy === 'pessimistic' ? 'ohlc_pessimistic' : 'ambiguous';
            }
            timeToHit = offset;
            break;
        }
        if (hitTarget) {
            firstHit = 'target_first';
            timeToHit = offset;
            pathResolution = 'ohlc_resolved';
            break;
        }
        if (hitStop) {
            firstHit = 'stop_first';
            timeToHit = offset;
            pathResolution = 'ohlc_resolved';
            break;
        }
    }
    return {
        mfe, mae, firstHit, timeToFirstHitBars: timeToHit, isAmbiguous, pathResolution, collision,
        targetFirst: firstHit === 'target_first', stopFirst: firstHit === 'stop_first', stopHit,
        timeToTarget, timeToStop, timeTo1R, timeTo2R, timeTo3R
    };
}
export function buildOutcomeLabel(evalIndex, horizonCandles, candles) {
    const endIndex = Math.min(candles.length - 1, evalIndex + horizonCandles);
    const startTimestamp = candles[evalIndex]?.timestamp ?? 0;
    const endTimestamp = candles[endIndex]?.timestamp ?? startTimestamp;
    return { startIndex: evalIndex, endIndex, startTimestamp, endTimestamp };
}
export function evaluateGenericOutcome(event, candles, causalAtr, config = DEFAULT_OUTCOME_CONFIG) {
    const evalIndex = event.availableAtIndex;
    const c = candles[evalIndex];
    const entry = c ? c.close : new Decimal(0);
    const traj = evaluateTrajectory(candles, {
        entry,
        direction: event.direction,
        atr: causalAtr,
        config,
        startOffset: evalIndex + 1
    });
    const mfeAtr = causalAtr.isZero() ? new Decimal(0) : traj.mfe.dividedBy(causalAtr);
    const maeAtr = causalAtr.isZero() ? new Decimal(0) : traj.mae.dividedBy(causalAtr);
    const targetHitR = traj.firstHit === 'target_first'
        ? new Decimal(config.targetR)
        : traj.firstHit === 'stop_first'
            ? new Decimal(-config.stopAtrMultiplier)
            : new Decimal(0);
    return {
        eventId: event.id,
        horizonCandles: config.horizonCandles,
        label: buildOutcomeLabel(evalIndex, config.horizonCandles, candles),
        mfe: traj.mfe,
        mae: traj.mae,
        mfeAtr,
        maeAtr,
        mfeR: mfeAtr,
        maeR: maeAtr,
        targetHitR,
        firstHit: traj.firstHit,
        timeToFirstHitBars: traj.timeToFirstHitBars,
        isAmbiguous: traj.isAmbiguous,
        pathResolution: traj.pathResolution,
        collision: traj.collision,
        targetFirst: traj.targetFirst,
        stopFirst: traj.stopFirst,
        stopHit: traj.stopHit,
        timeToTarget: traj.timeToTarget,
        timeToStop: traj.timeToStop,
        timeTo1R: traj.timeTo1R,
        timeTo2R: traj.timeTo2R,
        timeTo3R: traj.timeTo3R,
        targetHit1R: mfeAtr.gte(1),
        targetHit2R: mfeAtr.gte(2),
        targetHit3R: mfeAtr.gte(3),
        reached1R: mfeAtr.gte(1),
        reached2R: mfeAtr.gte(2),
        reached3R: mfeAtr.gte(3),
        hit1R: traj.firstHit === 'target_first' || mfeAtr.gte(1),
        hit2R: traj.firstHit === 'target_first' || (traj.firstHit !== 'stop_first' && mfeAtr.gte(2)),
        hit3R: traj.firstHit !== 'stop_first' && mfeAtr.gte(3)
    };
}
/**
 * Pure execution simulator that computes realized P&L, fees, and execution metrics from an outcome.
 */
export function simulateTradeExecution(outcome, entryPrice, riskAmount, config = {}) {
    const wonTrade = outcome.targetFirst && !outcome.stopFirst;
    const exitReason = wonTrade ? 'target' : outcome.stopFirst ? 'stop' : 'horizon_expired';
    const feeRate = new Decimal(config.feeBps ?? 0).dividedBy(10000);
    const costDrag = entryPrice.times(feeRate).times(2);
    const grossR = outcome.targetHitR;
    const costR = riskAmount.gt(0) ? costDrag.dividedBy(riskAmount) : new Decimal(0);
    const realizedR = grossR.minus(costR);
    return {
        entryPrice,
        exitPrice: wonTrade ? entryPrice.plus(riskAmount.times(grossR)) : entryPrice.minus(riskAmount),
        exitReason,
        realizedR,
        wonTrade,
        barsHeld: outcome.timeToFirstHitBars > 0 ? outcome.timeToFirstHitBars : outcome.horizonCandles
    };
}
//# sourceMappingURL=generic-outcomes.js.map