import { Decimal } from 'decimal.js';
import { evaluateGenericOutcome, DEFAULT_OUTCOME_CONFIG } from './outcome-evaluators.js';
import { calculateCausalAtr } from './study-runner.js';
import { estimateIndependentTrendRegime } from './context-features.js';
import { getActiveSessions } from '@nemesis-oss/market-events';
/**
 * Finds eligible non-event control candle indices for a given event,
 * matching on timeframe, direction, volatility bucket, temporal proximity,
 * and optionally stratifying by trend regime and trading session.
 */
export function findMatchedControlIndex(event, candles, unavailableIndices, options = {}) {
    const radius = options.searchRadiusBars ?? 50;
    const maxDev = options.maxAtrDeviationRatio ?? 0.30;
    const evalIndex = event.availableAtIndex ?? event.originIndex;
    const eventAtr = calculateCausalAtr(candles, evalIndex);
    const evTrend = options.matchTrendRegime ? estimateIndependentTrendRegime(candles, evalIndex) : null;
    const evSess = options.matchSession ? getActiveSessions(candles[evalIndex].timestamp)[0] : null;
    const start = Math.max(0, evalIndex - radius);
    const end = Math.min(candles.length - 1, evalIndex + radius);
    let bestIdx = null;
    let smallestDiff = new Decimal(Infinity);
    for (let i = start; i <= end; i++) {
        if (unavailableIndices.has(i) || Math.abs(i - evalIndex) < 2)
            continue;
        if (evTrend !== null && estimateIndependentTrendRegime(candles, i) !== evTrend)
            continue;
        if (evSess !== null && getActiveSessions(candles[i].timestamp)[0] !== evSess)
            continue;
        const candAtr = calculateCausalAtr(candles, i);
        const diff = candAtr.minus(eventAtr).abs();
        const ratio = diff.dividedBy(eventAtr.isZero() ? new Decimal(1) : eventAtr);
        if (ratio.lte(maxDev) && diff.lt(smallestDiff)) {
            smallestDiff = diff;
            bestIdx = i;
        }
    }
    return bestIdx;
}
/**
 * Generates direction-aware, volatility-matched control observations for an event population.
 * Strictly enforces 1:1 matching without replacement and rejects contaminated fallback neighbors.
 */
export function generateMatchedControls(events, candles, config = DEFAULT_OUTCOME_CONFIG, options = {}) {
    const unavailableIndices = new Set(events.flatMap(e => [e.originIndex, e.availableAtIndex]));
    const controls = [];
    for (const ev of events) {
        const matchedIdx = findMatchedControlIndex(ev, candles, unavailableIndices, options);
        // Discard unmatched events rather than contaminating control with event impulse
        if (matchedIdx === null)
            continue;
        // Enforce 1:1 matching without replacement to prevent pseudo-replication
        unavailableIndices.add(matchedIdx);
        const causalAtr = calculateCausalAtr(candles, matchedIdx);
        const ts = candles[matchedIdx]?.timestamp ?? 0;
        const controlPseudoEvent = {
            id: `ctrl-${ev.id}`,
            type: 'control',
            symbol: ev.symbol,
            timeframe: ev.timeframe,
            detectedAt: ts,
            originIndex: matchedIdx,
            originTimestamp: ts,
            availableAtIndex: matchedIdx,
            availableAtTimestamp: ts,
            direction: ev.direction // Exact direction symmetry!
        };
        const outcome = evaluateGenericOutcome(controlPseudoEvent, candles, causalAtr, config);
        controls.push({
            matchedEventId: ev.id,
            controlOriginIndex: matchedIdx,
            direction: ev.direction,
            causalAtr,
            outcome
        });
    }
    const matchRatio = events.length > 0 ? controls.length / events.length : 0;
    return Object.assign(controls, {
        matchRatio,
        matchedCount: controls.length,
        totalEvents: events.length
    });
}
//# sourceMappingURL=matched-controls.js.map