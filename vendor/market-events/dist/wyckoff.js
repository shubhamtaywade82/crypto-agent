/**
 * Detects Wyckoff structural events (Springs and Upthrusts) deterministically.
 * Spring: Price penetrates below a support level (e.g. established swing low) and immediately reclaims.
 * Upthrust: Price penetrates above a resistance level (established swing high) and reclaims.
 */
export function detectWyckoffEvents(candles, swings, options) {
    const events = [];
    for (let i = 0; i < candles.length; i++) {
        const c = candles[i];
        const activeSwings = swings.filter(s => s.confirmedAtIndex <= i);
        const lastLow = [...activeSwings].reverse().find(s => s.type === 'low');
        const lastHigh = [...activeSwings].reverse().find(s => s.type === 'high');
        // Wyckoff Spring: pierces prior support low, closes firmly back above it
        if (lastLow && c.low.lt(lastLow.price) && c.close.gt(lastLow.price)) {
            events.push({
                id: `${options.symbol}-${options.timeframe}-wyckoff-spring-${c.timestamp}`,
                type: 'wyckoff',
                symbol: options.symbol,
                timeframe: options.timeframe,
                detectedAt: c.timestamp,
                originIndex: lastLow.index,
                originTimestamp: lastLow.timestamp,
                availableAtIndex: i,
                availableAtTimestamp: c.timestamp,
                timeline: {
                    originIndex: lastLow.index,
                    originTimestamp: lastLow.timestamp,
                    formedAtIndex: i,
                    formedAtTimestamp: c.timestamp,
                    confirmedAtIndex: i,
                    confirmedAtTimestamp: c.timestamp,
                    availableAtIndex: i,
                    availableAtTimestamp: c.timestamp
                },
                direction: 'bullish',
                wyckoffType: 'spring',
                referenceLevel: lastLow.price,
                extremePrice: c.low
            });
        }
        // Wyckoff Upthrust (UT): pierces prior resistance high, closes firmly back below it
        if (lastHigh && c.high.gt(lastHigh.price) && c.close.lt(lastHigh.price)) {
            events.push({
                id: `${options.symbol}-${options.timeframe}-wyckoff-upthrust-${c.timestamp}`,
                type: 'wyckoff',
                symbol: options.symbol,
                timeframe: options.timeframe,
                detectedAt: c.timestamp,
                originIndex: lastHigh.index,
                originTimestamp: lastHigh.timestamp,
                availableAtIndex: i,
                availableAtTimestamp: c.timestamp,
                timeline: {
                    originIndex: lastHigh.index,
                    originTimestamp: lastHigh.timestamp,
                    formedAtIndex: i,
                    formedAtTimestamp: c.timestamp,
                    confirmedAtIndex: i,
                    confirmedAtTimestamp: c.timestamp,
                    availableAtIndex: i,
                    availableAtTimestamp: c.timestamp
                },
                direction: 'bearish',
                wyckoffType: 'upthrust',
                referenceLevel: lastHigh.price,
                extremePrice: c.high
            });
        }
    }
    return events;
}
//# sourceMappingURL=wyckoff.js.map