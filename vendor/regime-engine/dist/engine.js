import { detectSwings, detectLiquiditySweeps, detectDisplacement, } from '@nemesis-oss/market-events';
import { extractContextSnapshot } from '@nemesis-oss/market-research';
/**
 * Classify the composite market regime at a given candle index.
 *
 * This engine reuses the deterministic context extraction from
 * `market-research` (trend regime, volatility regime, ATR, session) and
 * extends it with:
 *  - **liquidity regime** — derived from swing density and sweep frequency
 *  - **momentum regime** — derived from rate-of-change over the lookback
 *  - **derivatives regime** — derived from OI delta (if supplied)
 *
 * The output is a {@link CompositeRegime} that can be used as a
 * conditioning variable: "FVG performance *when* trend is bullish AND
 * volatility is expanding AND OI is rising."
 */
export function classifyRegime(candles, index, symbol, timeframe, derivatives = {}, options = {}) {
    const trendLookback = options.trendLookback ?? 20;
    const swingSensitivity = options.swingSensitivity ?? { leftBars: 2, rightBars: 2 };
    // Reuse market-research's deterministic context extraction.
    const snapshot = extractContextSnapshot(candles, index);
    const trend = snapshot.trendRegime;
    const volatility = snapshot.volatilityRegime;
    // Momentum: rate of change over lookback.
    const momentum = computeMomentum(candles, index, trendLookback);
    // Liquidity: swing density + sweep frequency.
    const liquidity = computeLiquidityRegime(candles, index, symbol, timeframe, swingSensitivity);
    // Derivatives: OI delta.
    const derivativesRegime = computeDerivativesRegime(derivatives);
    const summary = [
        trend,
        volatility,
        liquidity,
        momentum,
        derivativesRegime,
    ].join('+');
    return {
        symbol,
        timeframe,
        candleIndex: index,
        timestamp: candles[index]?.timestamp ?? 0,
        trend,
        volatility,
        liquidity,
        momentum,
        derivatives: derivativesRegime,
        session: snapshot.session ?? 'off_hours',
        summary,
    };
}
function computeMomentum(candles, index, lookback) {
    if (index < lookback)
        return 'neutral';
    const start = candles[index - lookback];
    const current = candles[index];
    const change = current.close.minus(start.close);
    const pctChange = change.dividedBy(start.close).toNumber();
    if (pctChange > 0.01)
        return 'positive';
    if (pctChange < -0.01)
        return 'negative';
    return 'neutral';
}
function computeLiquidityRegime(candles, index, symbol, timeframe, swingSensitivity) {
    const lookback = Math.min(index, 50);
    const slice = candles.slice(Math.max(0, index - lookback), index + 1);
    if (slice.length < 10)
        return 'normal';
    const swings = detectSwings(slice, swingSensitivity);
    const sweeps = detectLiquiditySweeps(slice, swings, { symbol, timeframe });
    const displacement = detectDisplacement(slice, { symbol, timeframe });
    // Swing density: more swings = thinner liquidity (choppy market).
    const swingDensity = swings.length / slice.length;
    // Sweep density: more sweeps = liquidity being taken.
    const sweepDensity = sweeps.length / slice.length;
    // Displacement frequency: more displacement = deeper liquidity providing.
    const dispDensity = displacement.length / slice.length;
    const score = swingDensity * 2 + sweepDensity - dispDensity * 0.5;
    if (score > 0.3)
        return 'thin';
    if (score < 0.1)
        return 'deep';
    return 'normal';
}
function computeDerivativesRegime(derivatives) {
    const change = derivatives.openInterestChange;
    if (change === undefined)
        return 'flat_oi';
    if (change > 0.02)
        return 'rising_oi';
    if (change < -0.02)
        return 'falling_oi';
    return 'flat_oi';
}
/**
 * Compare two regimes and return the dimensions that differ.
 * Useful for detecting regime transitions.
 */
export function diffRegimes(a, b) {
    const diffs = [];
    if (a.trend !== b.trend)
        diffs.push(`trend: ${a.trend}→${b.trend}`);
    if (a.volatility !== b.volatility)
        diffs.push(`volatility: ${a.volatility}→${b.volatility}`);
    if (a.liquidity !== b.liquidity)
        diffs.push(`liquidity: ${a.liquidity}→${b.liquidity}`);
    if (a.momentum !== b.momentum)
        diffs.push(`momentum: ${a.momentum}→${b.momentum}`);
    if (a.derivatives !== b.derivatives)
        diffs.push(`derivatives: ${a.derivatives}→${b.derivatives}`);
    return diffs;
}
//# sourceMappingURL=engine.js.map