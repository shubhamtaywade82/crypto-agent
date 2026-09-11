import { Decimal } from 'decimal.js';
/**
 * Detects aggressive directional displacement candles based on ATR expansion and body dominance.
 */
export function detectDisplacement(candles, options) {
    if (candles.length < 15)
        return [];
    const minAtrMult = options.minMagnitudeAtr ?? new Decimal(1.5);
    const minBody = options.minBodyRatio ?? new Decimal(0.65);
    const events = [];
    for (let i = 14; i < candles.length; i++) {
        const c = candles[i];
        const range = c.high.minus(c.low);
        const body = c.close.minus(c.open).abs();
        // 14-period simple ATR
        let totalRange = new Decimal(0);
        for (let k = i - 14; k < i; k++) {
            totalRange = totalRange.plus(candles[k].high.minus(candles[k].low));
        }
        const atr = totalRange.dividedBy(14);
        if (atr.isZero())
            continue;
        const magnitudeAtr = range.dividedBy(atr);
        const bodyRatio = range.gt(0) ? body.dividedBy(range) : new Decimal(0);
        if (magnitudeAtr.gte(minAtrMult) && bodyRatio.gte(minBody)) {
            const isBull = c.close.gt(c.open);
            events.push({
                id: `${options.symbol}-${options.timeframe}-disp-${c.timestamp}`,
                type: 'displacement',
                symbol: options.symbol,
                timeframe: options.timeframe,
                detectedAt: c.timestamp,
                originIndex: i,
                originTimestamp: c.timestamp,
                availableAtIndex: i,
                availableAtTimestamp: c.timestamp,
                direction: isBull ? 'bullish' : 'bearish',
                magnitudeAtr,
                bodyRatio,
                candleIndex: i
            });
        }
    }
    return events;
}
//# sourceMappingURL=displacement.js.map