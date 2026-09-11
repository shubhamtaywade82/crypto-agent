import { Decimal } from 'decimal.js';
import { evaluateGenericOutcome, DEFAULT_OUTCOME_CONFIG, resolveCollision, buildOutcomeLabel } from './generic-outcomes.js';
export { evaluateGenericOutcome, DEFAULT_OUTCOME_CONFIG };
function checkZoneTouch(c, event, state, offset) {
    const isBull = event.direction === 'bullish';
    if (state.firstTouchBars === null && (isBull ? c.low.lte(event.top) : c.high.gte(event.bottom))) {
        state.firstTouchBars = offset;
    }
    // Halt penetration tracking once zone is invalidated
    if (state.firstTouchBars !== null && !state.isInvalidated) {
        const pen = isBull ? event.top.minus(c.low) : c.high.minus(event.bottom);
        if (pen.gt(state.maxPen))
            state.maxPen = pen;
        if (isBull ? c.close.lt(event.bottom) : c.close.gt(event.top))
            state.isInvalidated = true;
    }
}
function evaluateZoneTrajectory(event, candles, causalAtr, config) {
    const isBull = event.direction === 'bullish';
    const entry = isBull ? event.top : event.bottom;
    const span = event.top.minus(event.bottom).abs();
    const risk = span.gt(0) ? span : causalAtr;
    const target = isBull ? entry.plus(risk.times(config.targetR)) : entry.minus(risk.times(config.targetR));
    const stop = isBull ? (span.gt(0) ? event.bottom : entry.minus(risk)) : (span.gt(0) ? event.top : entry.plus(risk));
    const state = { firstTouchBars: null, maxPen: new Decimal(0), isInvalidated: false };
    let mfe = new Decimal(0), mae = new Decimal(0), timeToHit = 0;
    let firstHit = 'horizon_expired';
    let isAmbiguous = false, collision = false, stopHit = false;
    let pathResolution = 'exact';
    let timeToTarget = null, timeToStop = null;
    const evalIndex = event.availableAtIndex;
    const horizon = Math.min(candles.length, evalIndex + 1 + config.horizonCandles);
    for (let i = evalIndex + 1; i < horizon; i++) {
        const c = candles[i];
        const offset = i - evalIndex;
        checkZoneTouch(c, event, state, offset);
        const fav = isBull ? c.high.minus(entry) : entry.minus(c.low);
        if (fav.gt(mfe))
            mfe = fav;
        const adv = isBull ? entry.minus(c.low) : c.high.minus(entry);
        if (adv.gt(mae))
            mae = adv;
        const hitTarget = isBull ? c.high.gte(target) : c.low.lte(target);
        const hitStop = isBull ? c.low.lte(stop) : c.high.gte(stop);
        if (hitStop && !stopHit) {
            stopHit = true;
            timeToStop = offset;
        }
        if (hitTarget && timeToTarget === null)
            timeToTarget = offset;
        if (hitTarget && hitStop) {
            collision = true;
            isAmbiguous = true;
            timeToHit = offset;
            firstHit = resolveCollision(config.ambiguityPolicy);
            pathResolution = config.ambiguityPolicy === 'optimistic' ? 'ohlc_optimistic'
                : config.ambiguityPolicy === 'pessimistic' ? 'ohlc_pessimistic' : 'ambiguous';
            break;
        }
        if (hitTarget) {
            firstHit = 'target_first';
            timeToHit = offset;
            pathResolution = 'exact';
            break;
        }
        if (hitStop) {
            firstHit = 'stop_first';
            timeToHit = offset;
            pathResolution = 'exact';
            break;
        }
    }
    return {
        mfe, mae, maxPenetration: state.maxPen, firstTouchBars: state.firstTouchBars, isInvalidated: state.isInvalidated,
        firstHit, timeToFirstHitBars: timeToHit, isAmbiguous, pathResolution, collision,
        targetFirst: firstHit === 'target_first', stopFirst: firstHit === 'stop_first', stopHit, timeToTarget, timeToStop
    };
}
function computeOutcomeStats(traj, risk, causalAtr, config) {
    const mfeAtr = causalAtr.gt(0) ? traj.mfe.dividedBy(causalAtr) : new Decimal(0);
    const maeAtr = causalAtr.gt(0) ? traj.mae.dividedBy(causalAtr) : new Decimal(0);
    const mfeR = risk.gt(0) ? traj.mfe.dividedBy(risk) : new Decimal(0);
    const maeR = risk.gt(0) ? traj.mae.dividedBy(risk) : new Decimal(0);
    const targetHitR = traj.firstHit === 'target_first'
        ? new Decimal(config.targetR)
        : traj.firstHit === 'stop_first'
            ? new Decimal(-1)
            : new Decimal(0);
    return {
        mfeAtr,
        maeAtr,
        mfeR,
        maeR,
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
        targetHit1R: traj.mfe.gte(risk), targetHit2R: traj.mfe.gte(risk.times(2)), targetHit3R: traj.mfe.gte(risk.times(3)),
        reached1R: traj.firstHit === 'target_first' || traj.mfe.gte(risk),
        reached2R: traj.firstHit === 'target_first' || (traj.firstHit !== 'stop_first' && traj.mfe.gte(risk.times(2))),
        reached3R: traj.firstHit !== 'stop_first' && traj.mfe.gte(risk.times(3)),
        hit1R: traj.firstHit === 'target_first' || traj.mfe.gte(risk),
        hit2R: traj.firstHit === 'target_first' || (traj.firstHit !== 'stop_first' && traj.mfe.gte(risk.times(2))),
        hit3R: traj.firstHit !== 'stop_first' && traj.mfe.gte(risk.times(3))
    };
}
export function evaluateFvgOutcome(event, candles, causalAtr, config = DEFAULT_OUTCOME_CONFIG) {
    const traj = evaluateZoneTrajectory(event, candles, causalAtr, config);
    const span = event.top.minus(event.bottom).abs();
    const risk = span.gt(0) ? span : causalAtr;
    const penRatio = span.isZero() ? new Decimal(0) : traj.maxPenetration.dividedBy(span);
    const stats = computeOutcomeStats(traj, risk, causalAtr, config);
    const evalIdx = event.availableAtIndex ?? event.originIndex;
    return {
        eventId: event.id,
        horizonCandles: config.horizonCandles,
        label: buildOutcomeLabel(evalIdx, config.horizonCandles, candles),
        mfe: traj.mfe, mae: traj.mae, ...stats,
        firstTouchBars: traj.firstTouchBars,
        firstTouchIndex: traj.firstTouchBars !== null ? evalIdx + traj.firstTouchBars : null,
        fill25: penRatio.gte(0.25), fill50: penRatio.gte(0.50), fill75: penRatio.gte(0.75), fill100: penRatio.gte(1.0),
        touch25: penRatio.gte(0.25), touch50: penRatio.gte(0.50), touch75: penRatio.gte(0.75), fullFill: penRatio.gte(1.0),
        isMitigated: traj.firstTouchBars !== null, isInvalidated: traj.isInvalidated
    };
}
export function evaluateOrderBlockOutcome(event, candles, causalAtr, config = DEFAULT_OUTCOME_CONFIG) {
    const traj = evaluateZoneTrajectory(event, candles, causalAtr, config);
    const span = event.top.minus(event.bottom).abs();
    const risk = span.gt(0) ? span : causalAtr;
    const stats = computeOutcomeStats(traj, risk, causalAtr, config);
    const evalIdx = event.availableAtIndex ?? event.originIndex;
    return {
        eventId: event.id,
        horizonCandles: config.horizonCandles,
        label: buildOutcomeLabel(evalIdx, config.horizonCandles, candles),
        mfe: traj.mfe, mae: traj.mae, ...stats,
        firstTouchBars: traj.firstTouchBars,
        maxPenetrationRatio: span.isZero() ? new Decimal(0) : traj.maxPenetration.dividedBy(span),
        isMitigated: traj.firstTouchBars !== null, isBreaker: traj.isInvalidated
    };
}
export function evaluateStructureOutcome(event, candles, causalAtr, config = DEFAULT_OUTCOME_CONFIG) {
    const base = evaluateGenericOutcome(event, candles, causalAtr, config);
    const isBull = event.direction === 'bullish';
    const tol = causalAtr.times(0.2);
    let hasRetested = false;
    let retestBars = null;
    const evalIndex = event.availableAtIndex ?? event.originIndex;
    const horizon = Math.min(candles.length, evalIndex + 1 + config.horizonCandles);
    for (let i = evalIndex + 1; i < horizon; i++) {
        const c = candles[i];
        const retested = isBull
            ? c.low.lte(event.breakPrice.plus(tol)) && c.low.gte(event.breakPrice.minus(tol))
            : c.high.gte(event.breakPrice.minus(tol)) && c.high.lte(event.breakPrice.plus(tol));
        if (retested && !hasRetested) {
            hasRetested = true;
            retestBars = i - evalIndex;
            break;
        }
    }
    // nextBreakBars: bars until price creates a new structural extreme beyond the break level
    let nextBreakBars = null;
    const threshold = isBull ? event.breakPrice.plus(causalAtr.times(0.5)) : event.breakPrice.minus(causalAtr.times(0.5));
    for (let i = evalIndex + 1; i < horizon; i++) {
        const c = candles[i];
        const extended = isBull ? c.high.gte(threshold) : c.low.lte(threshold);
        if (extended) {
            nextBreakBars = i - evalIndex;
            break;
        }
    }
    return {
        ...base,
        hasRetested,
        retestBars,
        isContinuation: base.hit2R,
        nextBreakBars
    };
}
export function evaluateLiquiditySweepOutcome(event, candles, causalAtr, config = DEFAULT_OUTCOME_CONFIG) {
    const base = evaluateGenericOutcome(event, candles, causalAtr, config);
    const isBull = event.direction === 'bullish';
    const evalIndex = event.availableAtIndex ?? event.originIndex;
    let isReclaimed = false, reclaimBars = null;
    const horizon = Math.min(candles.length, evalIndex + 1 + config.horizonCandles);
    // Scan lookback for opposing liquidity pool level
    const lookback = Math.max(0, evalIndex - 20);
    let opposingLevel = isBull ? candles[lookback].high : candles[lookback].low;
    for (let j = lookback; j <= evalIndex; j++) {
        opposingLevel = isBull ? Decimal.max(opposingLevel, candles[j].high) : Decimal.min(opposingLevel, candles[j].low);
    }
    let oppositeLiquidityTaken = false;
    for (let i = evalIndex + 1; i < horizon; i++) {
        const c = candles[i];
        const reclaimed = isBull ? c.close.gt(event.sweptLevel) : c.close.lt(event.sweptLevel);
        if (reclaimed && !isReclaimed) {
            isReclaimed = true;
            reclaimBars = i - evalIndex;
        }
        const hitOpposite = isBull ? c.high.gte(opposingLevel) : c.low.lte(opposingLevel);
        if (hitOpposite)
            oppositeLiquidityTaken = true;
    }
    return {
        ...base,
        isReclaimed,
        reclaimBars,
        postSweepDisplacementAtr: base.mfeAtr,
        oppositeLiquidityTaken
    };
}
export function evaluateEventOutcome(event, candles, causalAtr, config = DEFAULT_OUTCOME_CONFIG) {
    if (event.type === 'fvg')
        return evaluateFvgOutcome(event, candles, causalAtr, config);
    if (event.type === 'order_block')
        return evaluateOrderBlockOutcome(event, candles, causalAtr, config);
    if (event.type === 'bos' || event.type === 'mss')
        return evaluateStructureOutcome(event, candles, causalAtr, config);
    if (event.type === 'liquidity_sweep')
        return evaluateLiquiditySweepOutcome(event, candles, causalAtr, config);
    return evaluateGenericOutcome(event, candles, causalAtr, config);
}
//# sourceMappingURL=outcome-evaluators.js.map