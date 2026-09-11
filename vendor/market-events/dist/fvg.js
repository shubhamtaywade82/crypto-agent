import { Decimal } from 'decimal.js';
/**
 * Detects 3-candle Fair Value Gaps deterministically.
 * Bullish FVG: candle[i-2].high < candle[i].low
 * Bearish FVG: candle[i-2].low > candle[i].high
 */
export function detectFvg(candles, options) {
    if (candles.length < 3) {
        return [];
    }
    const events = [];
    const minGap = options.minGapTicks ?? new Decimal(0);
    for (let i = 2; i < candles.length; i++) {
        const first = candles[i - 2];
        const third = candles[i];
        if (third.low.minus(first.high).gt(minGap)) {
            const top = third.low;
            const bottom = first.high;
            const size = top.minus(bottom);
            const consequentEncroachment = bottom.plus(size.dividedBy(2));
            events.push({
                id: `${options.symbol}-${options.timeframe}-fvg-bull-${third.timestamp}`,
                type: 'fvg',
                version: '1.0.0',
                symbol: options.symbol,
                timeframe: options.timeframe,
                detectedAt: third.timestamp,
                originIndex: i - 2,
                originTimestamp: first.timestamp,
                availableAtIndex: i,
                availableAtTimestamp: third.timestamp,
                timeline: {
                    originIndex: i - 2,
                    originTimestamp: first.timestamp,
                    formedAtIndex: i - 1,
                    formedAtTimestamp: candles[i - 1].timestamp,
                    confirmedAtIndex: i,
                    confirmedAtTimestamp: third.timestamp,
                    availableAtIndex: i,
                    availableAtTimestamp: third.timestamp
                },
                direction: 'bullish',
                top,
                bottom,
                consequentEncroachment,
                size
            });
        }
        else if (first.low.minus(third.high).gt(minGap)) {
            const top = first.low;
            const bottom = third.high;
            const size = top.minus(bottom);
            const consequentEncroachment = bottom.plus(size.dividedBy(2));
            events.push({
                id: `${options.symbol}-${options.timeframe}-fvg-bear-${third.timestamp}`,
                type: 'fvg',
                version: '1.0.0',
                symbol: options.symbol,
                timeframe: options.timeframe,
                detectedAt: third.timestamp,
                originIndex: i - 2,
                originTimestamp: first.timestamp,
                availableAtIndex: i,
                availableAtTimestamp: third.timestamp,
                timeline: {
                    originIndex: i - 2,
                    originTimestamp: first.timestamp,
                    formedAtIndex: i - 1,
                    formedAtTimestamp: candles[i - 1].timestamp,
                    confirmedAtIndex: i,
                    confirmedAtTimestamp: third.timestamp,
                    availableAtIndex: i,
                    availableAtTimestamp: third.timestamp
                },
                direction: 'bearish',
                top,
                bottom,
                consequentEncroachment,
                size
            });
        }
    }
    return events;
}
//# sourceMappingURL=fvg.js.map