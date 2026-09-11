function resolveDualBreak(candle, highBreached, lowBreached, policy = 'close_direction') {
    if (!highBreached || !lowBreached) {
        return { allowHigh: highBreached, allowLow: lowBreached };
    }
    if (policy === 'skip')
        return { allowHigh: false, allowLow: false };
    if (policy === 'allow_both')
        return { allowHigh: true, allowLow: true };
    // 'close_direction': prioritize break in the direction of candle body close
    const isCloseUp = candle.close.gte(candle.open);
    return { allowHigh: isCloseUp, allowLow: !isCloseUp };
}
/**
 * Detects Break of Structure (BOS), Change of Character (CHoCH), and Market Structure Shift (MSS)
 * using an explicit multi-state structure model with same-bar dual break resolution.
 */
export function detectStructureBreaks(candles, swings, options) {
    const breaks = [];
    const requireClose = options.requireClose ?? true;
    const brokenSwingIds = new Set();
    let state = {
        trend: 'sideways',
        transition: 'continuation'
    };
    for (let i = 0; i < candles.length; i++) {
        const candle = candles[i];
        const activeSwings = swings.filter(s => s.confirmedAtIndex <= i && !brokenSwingIds.has(s.id));
        const lastHigh = [...activeSwings].reverse().find(s => s.type === 'high');
        const lastLow = [...activeSwings].reverse().find(s => s.type === 'low');
        const highBreached = !!lastHigh && (requireClose ? candle.close.gt(lastHigh.price) : candle.high.gt(lastHigh.price));
        const lowBreached = !!lastLow && (requireClose ? candle.close.lt(lastLow.price) : candle.low.lt(lastLow.price));
        const { allowHigh, allowLow } = resolveDualBreak(candle, highBreached, lowBreached, options.dualBreakPolicy);
        if (allowHigh && lastHigh) {
            const prevTrend = state.trend;
            const isMss = prevTrend === 'bearish';
            const isChoch = prevTrend === 'bearish' && (lastHigh.strength === 'micro' || lastHigh.strength === 'minor');
            const eventType = isChoch ? 'choch' : isMss ? 'mss' : 'bos';
            const level = (lastHigh.strength === 'micro' || lastHigh.strength === 'minor') ? 'internal' : 'external';
            const nextTrend = 'bullish';
            brokenSwingIds.add(lastHigh.id);
            state = {
                trend: nextTrend,
                transition: isMss ? 'mss' : isChoch ? 'choch' : 'continuation',
                lastConfirmedHigh: lastHigh,
                protectedLow: lastLow
            };
            breaks.push({
                id: `${options.symbol}-${options.timeframe}-${eventType}-bull-${candle.timestamp}`,
                type: eventType,
                version: '1.0.0',
                symbol: options.symbol,
                timeframe: options.timeframe,
                detectedAt: candle.timestamp,
                originIndex: lastHigh.index,
                originTimestamp: lastHigh.timestamp,
                availableAtIndex: i,
                availableAtTimestamp: candle.timestamp,
                timeline: {
                    originIndex: lastHigh.index,
                    originTimestamp: lastHigh.timestamp,
                    formedAtIndex: i,
                    formedAtTimestamp: candle.timestamp,
                    confirmedAtIndex: i,
                    confirmedAtTimestamp: candle.timestamp,
                    availableAtIndex: i,
                    availableAtTimestamp: candle.timestamp
                },
                direction: 'bullish',
                brokenSwing: lastHigh,
                breakPrice: candle.close,
                isCloseConfirmed: candle.close.gt(lastHigh.price),
                level,
                trendBeforeBreak: prevTrend,
                trendAfterBreak: nextTrend
            });
        }
        if (allowLow && lastLow) {
            const prevTrend = state.trend;
            const isMss = prevTrend === 'bullish';
            const isChoch = prevTrend === 'bullish' && (lastLow.strength === 'micro' || lastLow.strength === 'minor');
            const eventType = isChoch ? 'choch' : isMss ? 'mss' : 'bos';
            const level = (lastLow.strength === 'micro' || lastLow.strength === 'minor') ? 'internal' : 'external';
            const nextTrend = 'bearish';
            brokenSwingIds.add(lastLow.id);
            state = {
                trend: nextTrend,
                transition: isMss ? 'mss' : isChoch ? 'choch' : 'continuation',
                lastConfirmedLow: lastLow,
                protectedHigh: lastHigh
            };
            breaks.push({
                id: `${options.symbol}-${options.timeframe}-${eventType}-bear-${candle.timestamp}`,
                type: eventType,
                version: '1.0.0',
                symbol: options.symbol,
                timeframe: options.timeframe,
                detectedAt: candle.timestamp,
                originIndex: lastLow.index,
                originTimestamp: lastLow.timestamp,
                availableAtIndex: i,
                availableAtTimestamp: candle.timestamp,
                timeline: {
                    originIndex: lastLow.index,
                    originTimestamp: lastLow.timestamp,
                    formedAtIndex: i,
                    formedAtTimestamp: candle.timestamp,
                    confirmedAtIndex: i,
                    confirmedAtTimestamp: candle.timestamp,
                    availableAtIndex: i,
                    availableAtTimestamp: candle.timestamp
                },
                direction: 'bearish',
                brokenSwing: lastLow,
                breakPrice: candle.close,
                isCloseConfirmed: candle.close.lt(lastLow.price),
                level,
                trendBeforeBreak: prevTrend,
                trendAfterBreak: nextTrend
            });
        }
    }
    return breaks;
}
/**
 * Detects Break of Structure (BOS) indicating trend continuation.
 */
export function detectBos(candles, swings, options) {
    return detectStructureBreaks(candles, swings, options).filter(b => b.type === 'bos');
}
/**
 * Detects Change of Character (CHoCH) indicating early counter-trend internal structure breach.
 */
export function detectChoch(candles, swings, options) {
    return detectStructureBreaks(candles, swings, options).filter(b => b.type === 'choch');
}
/**
 * Detects Market Structure Shift (MSS) indicating external major structural reversal.
 */
export function detectMss(candles, swings, options) {
    return detectStructureBreaks(candles, swings, options).filter(b => b.type === 'mss');
}
//# sourceMappingURL=structure.js.map