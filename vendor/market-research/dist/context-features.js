import { Decimal } from 'decimal.js';
import { getActiveSessions } from '@nemesis-oss/market-events';
import { extractMultiTimeframeSnapshot } from './multi-timeframe.js';
export function estimateIndependentTrendRegime(candles, index, period = 20) {
    if (index < 1)
        return 'range';
    const start = Math.max(0, index - period);
    const startCandle = candles[start];
    const currentCandle = candles[index];
    const netMove = currentCandle.close.minus(startCandle.close);
    let totalPath = new Decimal(0);
    for (let i = start + 1; i <= index; i++) {
        totalPath = totalPath.plus(candles[i].close.minus(candles[i - 1].close).abs());
    }
    // Directional efficiency = net displacement / total path length
    const efficiency = totalPath.gt(0) ? netMove.abs().dividedBy(totalPath) : new Decimal(0);
    if (efficiency.lt(0.30))
        return 'range';
    return netMove.gt(0) ? 'bullish' : 'bearish';
}
/**
 * Extracts context features (trend, volatility, displacement, session) at a specific candle index.
 */
export function extractContextFeatures(candles, currentIndex, swings, breaks) {
    const c = candles[currentIndex];
    const currentRange = c.high.minus(c.low);
    const lookback = Math.min(currentIndex, 14);
    let totalRange = new Decimal(0);
    for (let i = currentIndex - lookback; i < currentIndex; i++) {
        if (i >= 0)
            totalRange = totalRange.plus(candles[i].high.minus(candles[i].low));
    }
    const atr = lookback > 0 ? totalRange.dividedBy(lookback) : currentRange;
    const displacementAtr = atr.gt(0) ? currentRange.dividedBy(atr) : new Decimal(1);
    let volatilityRegime = 'normal';
    if (displacementAtr.lt(0.7))
        volatilityRegime = 'low';
    else if (displacementAtr.gt(1.8))
        volatilityRegime = 'high';
    // Use structure break if available, otherwise independent directional efficiency
    const priorBreaks = breaks ? breaks.filter(b => b.originIndex <= currentIndex) : [];
    const lastBreak = priorBreaks[priorBreaks.length - 1];
    const trendRegime = lastBreak ? lastBreak.direction : estimateIndependentTrendRegime(candles, currentIndex);
    const activeSess = getActiveSessions(c.timestamp);
    const session = activeSess[0] ?? 'off_hours';
    return { trendRegime, volatilityRegime, atr, displacementAtr, session };
}
export function extractContextSnapshot(candles, currentIndex, htfCandlesMap) {
    const feat = extractContextFeatures(candles, currentIndex);
    const currentCandle = candles[currentIndex];
    const htfContext = (htfCandlesMap && currentCandle)
        ? extractMultiTimeframeSnapshot(htfCandlesMap, currentCandle.timestamp)
        : undefined;
    return {
        atr: feat.atr,
        trendRegime: feat.trendRegime,
        volatilityRegime: feat.volatilityRegime,
        session: feat.session,
        ...(htfContext && Object.keys(htfContext).length > 0 ? { htfContext } : {})
    };
}
//# sourceMappingURL=context-features.js.map