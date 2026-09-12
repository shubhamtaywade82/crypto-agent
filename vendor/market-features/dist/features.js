import { Decimal } from 'decimal.js';
/**
 * Compute a feature vector at a given candle index.
 *
 * Pure and deterministic: same candles + same index → same features.
 * No look-ahead: only uses candles[0..index].
 */
export function computeFeatures(candles, index, symbol, derivatives = {}, options = {}) {
    if (index < 0 || index >= candles.length) {
        throw new Error(`index ${index} out of range [0, ${candles.length})`);
    }
    const atrPeriod = options.atrPeriod ?? 14;
    const volumeLookback = options.volumeLookback ?? 20;
    const momentumLookback = options.momentumLookback ?? 10;
    const candle = candles[index];
    // --- Price features ---
    const returns = index > 0
        ? candle.close.minus(candles[index - 1].close).dividedBy(candles[index - 1].close)
        : new Decimal(0);
    const atr = computeAtr(candles, index, atrPeriod);
    const range = candle.high.minus(candle.low);
    const rangeRatio = atr.gt(0) ? range.dividedBy(atr) : new Decimal(0);
    const momentum = computeMomentum(candles, index, momentumLookback);
    // --- Volume features ---
    const volumeDelta = index > 0
        ? candle.volume.minus(candles[index - 1].volume)
        : new Decimal(0);
    const avgVolume = computeAvgVolume(candles, index, volumeLookback);
    const relativeVolume = avgVolume.gt(0)
        ? candle.volume.dividedBy(avgVolume)
        : new Decimal(1);
    const cvd = computeCvd(candles, index, volumeLookback);
    // --- Microstructure proxies (from OHLC) ---
    const body = candle.close.minus(candle.open).abs();
    const totalRange = candle.high.minus(candle.low);
    const bodyRatio = totalRange.gt(0) ? body.dividedBy(totalRange) : new Decimal(0);
    const wickRatio = new Decimal(1).minus(bodyRatio);
    const spreadRatio = totalRange.gt(0)
        ? totalRange.dividedBy(candle.close)
        : new Decimal(0);
    // --- Derivatives features (optional) ---
    let derivativesSection;
    if (derivatives.openInterest !== undefined && derivatives.prevOpenInterest !== undefined) {
        const oiChange = derivatives.prevOpenInterest > 0
            ? (derivatives.openInterest - derivatives.prevOpenInterest) / derivatives.prevOpenInterest
            : 0;
        derivativesSection = {
            oiChange: new Decimal(oiChange).toString(),
            fundingRate: new Decimal(derivatives.fundingRate ?? 0).toString(),
        };
    }
    return {
        symbol,
        candleIndex: index,
        timestamp: candle.timestamp,
        price: {
            returns: returns.toString(),
            atr: atr.toString(),
            rangeRatio: rangeRatio.toString(),
            momentum: momentum.toString(),
        },
        volume: {
            volumeDelta: volumeDelta.toString(),
            relativeVolume: relativeVolume.toString(),
            cvd: cvd.toString(),
        },
        microstructure: {
            bodyRatio: bodyRatio.toString(),
            wickRatio: wickRatio.toString(),
            spreadRatio: spreadRatio.toString(),
        },
        ...(derivativesSection !== undefined ? { derivatives: derivativesSection } : {}),
    };
}
function computeAtr(candles, index, period) {
    if (index === 0)
        return candles[0].high.minus(candles[0].low);
    const lookback = Math.min(index, period);
    let sum = new Decimal(0);
    for (let i = index - lookback + 1; i <= index; i++) {
        const c = candles[i];
        const prevClose = candles[i - 1].close;
        const tr = Decimal.max(c.high.minus(c.low), c.high.minus(prevClose).abs(), c.low.minus(prevClose).abs());
        sum = sum.plus(tr);
    }
    return sum.dividedBy(lookback);
}
function computeAvgVolume(candles, index, lookback) {
    if (index === 0)
        return candles[0].volume;
    const start = Math.max(0, index - lookback);
    let sum = new Decimal(0);
    let count = 0;
    for (let i = start; i < index; i++) {
        sum = sum.plus(candles[i].volume);
        count++;
    }
    return count > 0 ? sum.dividedBy(count) : candles[index].volume;
}
function computeMomentum(candles, index, lookback) {
    if (index < lookback)
        return new Decimal(0);
    const start = candles[index - lookback];
    const current = candles[index];
    return current.close.minus(start.close).dividedBy(start.close);
}
/**
 * Cumulative Volume Delta over a lookback window.
 * Positive CVD = buying pressure; negative = selling pressure.
 * Proxy: close > open → buy volume; close < open → sell volume.
 */
function computeCvd(candles, index, lookback) {
    const start = Math.max(0, index - lookback);
    let cvd = new Decimal(0);
    for (let i = start; i <= index; i++) {
        const c = candles[i];
        if (c.close.gt(c.open)) {
            cvd = cvd.plus(c.volume);
        }
        else if (c.close.lt(c.open)) {
            cvd = cvd.minus(c.volume);
        }
    }
    return cvd;
}
//# sourceMappingURL=features.js.map