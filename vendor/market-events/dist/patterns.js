import { Decimal } from 'decimal.js';
/**
 * Detects classical Double Tops and Double Bottoms from confirmed swing points.
 */
export function detectDoublePatterns(swings, options) {
    const tolerance = options.toleranceRatio ?? new Decimal(0.005); // 0.5% price tolerance
    const events = [];
    const highs = swings.filter(s => s.type === 'high');
    for (let i = 1; i < highs.length; i++) {
        const first = highs[i - 1];
        const second = highs[i];
        const diff = first.price.minus(second.price).abs();
        const ratio = diff.dividedBy(first.price);
        if (ratio.lte(tolerance)) {
            // Find intervening swing low as neckline
            const intervening = swings.filter(s => s.type === 'low' && s.index > first.index && s.index < second.index);
            const neckline = intervening[0]?.price ?? first.price;
            events.push({
                id: `${options.symbol}-${options.timeframe}-double-top-${second.timestamp}`,
                type: 'chart_pattern',
                symbol: options.symbol,
                timeframe: options.timeframe,
                detectedAt: second.timestamp,
                originIndex: first.index,
                originTimestamp: first.timestamp,
                availableAtIndex: second.confirmedAtIndex,
                availableAtTimestamp: second.confirmedAtTimestamp ?? second.timestamp,
                timeline: {
                    originIndex: first.index,
                    originTimestamp: first.timestamp,
                    formedAtIndex: second.index,
                    formedAtTimestamp: second.timestamp,
                    confirmedAtIndex: second.confirmedAtIndex,
                    confirmedAtTimestamp: second.confirmedAtTimestamp ?? second.timestamp,
                    availableAtIndex: second.confirmedAtIndex,
                    availableAtTimestamp: second.confirmedAtTimestamp ?? second.timestamp
                },
                direction: 'bearish',
                patternType: 'double_top',
                firstLevel: first.price,
                secondLevel: second.price,
                neckline
            });
        }
    }
    const lows = swings.filter(s => s.type === 'low');
    for (let i = 1; i < lows.length; i++) {
        const first = lows[i - 1];
        const second = lows[i];
        const diff = first.price.minus(second.price).abs();
        const ratio = diff.dividedBy(first.price);
        if (ratio.lte(tolerance)) {
            // Find intervening swing high as neckline
            const intervening = swings.filter(s => s.type === 'high' && s.index > first.index && s.index < second.index);
            const neckline = intervening[0]?.price ?? first.price;
            events.push({
                id: `${options.symbol}-${options.timeframe}-double-bottom-${second.timestamp}`,
                type: 'chart_pattern',
                symbol: options.symbol,
                timeframe: options.timeframe,
                detectedAt: second.timestamp,
                originIndex: first.index,
                originTimestamp: first.timestamp,
                availableAtIndex: second.confirmedAtIndex,
                availableAtTimestamp: second.confirmedAtTimestamp ?? second.timestamp,
                timeline: {
                    originIndex: first.index,
                    originTimestamp: first.timestamp,
                    formedAtIndex: second.index,
                    formedAtTimestamp: second.timestamp,
                    confirmedAtIndex: second.confirmedAtIndex,
                    confirmedAtTimestamp: second.confirmedAtTimestamp ?? second.timestamp,
                    availableAtIndex: second.confirmedAtIndex,
                    availableAtTimestamp: second.confirmedAtTimestamp ?? second.timestamp
                },
                direction: 'bullish',
                patternType: 'double_bottom',
                firstLevel: first.price,
                secondLevel: second.price,
                neckline
            });
        }
    }
    return events;
}
//# sourceMappingURL=patterns.js.map