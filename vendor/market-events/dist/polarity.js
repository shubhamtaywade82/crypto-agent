/**
 * Detects Breaker Blocks: An Order Block that failed and got pierced through becomes polarity flipped.
 * Bullish OB invalidated by downward close -> Bearish Breaker.
 * Bearish OB invalidated by upward close -> Bullish Breaker.
 */
export function detectBreakerBlocks(candles, orderBlocks, options) {
    const breakers = [];
    for (const ob of orderBlocks) {
        for (let i = ob.originIndex + 1; i < candles.length; i++) {
            const c = candles[i];
            if (ob.direction === 'bullish' && c.close.lt(ob.bottom)) {
                breakers.push({
                    id: `${options.symbol}-${options.timeframe}-breaker-bear-${c.timestamp}`,
                    type: 'breaker_block',
                    symbol: options.symbol,
                    timeframe: options.timeframe,
                    detectedAt: c.timestamp,
                    originIndex: ob.originIndex,
                    originTimestamp: ob.originTimestamp,
                    availableAtIndex: i,
                    availableAtTimestamp: c.timestamp,
                    timeline: {
                        originIndex: ob.originIndex,
                        originTimestamp: ob.originTimestamp,
                        formedAtIndex: i,
                        formedAtTimestamp: c.timestamp,
                        confirmedAtIndex: i,
                        confirmedAtTimestamp: c.timestamp,
                        availableAtIndex: i,
                        availableAtTimestamp: c.timestamp
                    },
                    direction: 'bearish',
                    top: ob.top,
                    bottom: ob.bottom,
                    size: ob.size,
                    originalOrderBlockId: ob.id
                });
                break;
            }
            else if (ob.direction === 'bearish' && c.close.gt(ob.top)) {
                breakers.push({
                    id: `${options.symbol}-${options.timeframe}-breaker-bull-${c.timestamp}`,
                    type: 'breaker_block',
                    symbol: options.symbol,
                    timeframe: options.timeframe,
                    detectedAt: c.timestamp,
                    originIndex: ob.originIndex,
                    originTimestamp: ob.originTimestamp,
                    availableAtIndex: i,
                    availableAtTimestamp: c.timestamp,
                    timeline: {
                        originIndex: ob.originIndex,
                        originTimestamp: ob.originTimestamp,
                        formedAtIndex: i,
                        formedAtTimestamp: c.timestamp,
                        confirmedAtIndex: i,
                        confirmedAtTimestamp: c.timestamp,
                        availableAtIndex: i,
                        availableAtTimestamp: c.timestamp
                    },
                    direction: 'bullish',
                    top: ob.top,
                    bottom: ob.bottom,
                    size: ob.size,
                    originalOrderBlockId: ob.id
                });
                break;
            }
        }
    }
    return breakers;
}
/**
 * Detects Inverted Fair Value Gaps (IFVG): FVG that is closed through flips polarity.
 */
export function detectInvertedFvg(candles, fvgs, options) {
    const ifvgs = [];
    for (const fvg of fvgs) {
        for (let i = fvg.originIndex + 1; i < candles.length; i++) {
            const c = candles[i];
            if (fvg.direction === 'bullish' && c.close.lt(fvg.bottom)) {
                ifvgs.push({
                    id: `${options.symbol}-${options.timeframe}-ifvg-bear-${c.timestamp}`,
                    type: 'ifvg',
                    symbol: options.symbol,
                    timeframe: options.timeframe,
                    detectedAt: c.timestamp,
                    originIndex: fvg.originIndex,
                    originTimestamp: fvg.originTimestamp,
                    availableAtIndex: i,
                    availableAtTimestamp: c.timestamp,
                    timeline: {
                        originIndex: fvg.originIndex,
                        originTimestamp: fvg.originTimestamp,
                        formedAtIndex: i,
                        formedAtTimestamp: c.timestamp,
                        confirmedAtIndex: i,
                        confirmedAtTimestamp: c.timestamp,
                        availableAtIndex: i,
                        availableAtTimestamp: c.timestamp
                    },
                    direction: 'bearish',
                    top: fvg.top,
                    bottom: fvg.bottom,
                    size: fvg.size,
                    originalFvgId: fvg.id
                });
                break;
            }
            else if (fvg.direction === 'bearish' && c.close.gt(fvg.top)) {
                ifvgs.push({
                    id: `${options.symbol}-${options.timeframe}-ifvg-bull-${c.timestamp}`,
                    type: 'ifvg',
                    symbol: options.symbol,
                    timeframe: options.timeframe,
                    detectedAt: c.timestamp,
                    originIndex: fvg.originIndex,
                    originTimestamp: fvg.originTimestamp,
                    availableAtIndex: i,
                    availableAtTimestamp: c.timestamp,
                    timeline: {
                        originIndex: fvg.originIndex,
                        originTimestamp: fvg.originTimestamp,
                        formedAtIndex: i,
                        formedAtTimestamp: c.timestamp,
                        confirmedAtIndex: i,
                        confirmedAtTimestamp: c.timestamp,
                        availableAtIndex: i,
                        availableAtTimestamp: c.timestamp
                    },
                    direction: 'bullish',
                    top: fvg.top,
                    bottom: fvg.bottom,
                    size: fvg.size,
                    originalFvgId: fvg.id
                });
                break;
            }
        }
    }
    return ifvgs;
}
//# sourceMappingURL=polarity.js.map