import type { Candle, Timeframe } from '@nemesis-oss/market-events';
/**
 * Individual regime dimensions. Each produces a categorical label that
 * can be used as a conditioning variable in event research.
 */
export type TrendRegime = 'bullish' | 'bearish' | 'range';
export type VolatilityRegime = 'low' | 'normal' | 'high' | 'expanding';
export type LiquidityRegime = 'thin' | 'normal' | 'deep';
export type MomentumRegime = 'positive' | 'negative' | 'neutral';
export type DerivativesRegime = 'rising_oi' | 'falling_oi' | 'flat_oi';
/**
 * The composite regime is the full multi-dimensional classification of
 * the market at a point in time. This is the primary output of the
 * regime engine.
 *
 * Example:
 *   SOLUSDT 15m
 *   ├── trend:       bullish
 *   ├── volatility:  expanding
 *   ├── liquidity:   thin
 *   ├── momentum:    positive
 *   ├── derivatives: rising_oi
 *   └── session:     NY
 */
export interface CompositeRegime {
    readonly symbol: string;
    readonly timeframe: Timeframe;
    readonly candleIndex: number;
    readonly timestamp: number;
    readonly trend: TrendRegime;
    readonly volatility: VolatilityRegime;
    readonly liquidity: LiquidityRegime;
    readonly momentum: MomentumRegime;
    readonly derivatives: DerivativesRegime;
    readonly session: 'asia' | 'london' | 'new_york' | 'off_hours';
    /** A short human-readable summary, e.g. "bullish+expanding+thin+rising_oi". */
    readonly summary: string;
}
export interface DerivativesSnapshot {
    readonly openInterest?: number | undefined;
    readonly openInterestChange?: number | undefined;
    readonly fundingRate?: number | undefined;
}
export interface RegimeEngineOptions {
    /** Lookback for trend/momentum regime. Default 20 candles. */
    readonly trendLookback?: number;
    /** ATR period for volatility regime. Default 14. */
    readonly atrPeriod?: number;
    /** Swing detection sensitivity. Default { leftBars: 2, rightBars: 2 }. */
    readonly swingSensitivity?: {
        leftBars: number;
        rightBars: number;
    };
}
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
export declare function classifyRegime(candles: readonly Candle[], index: number, symbol: string, timeframe: Timeframe, derivatives?: DerivativesSnapshot, options?: RegimeEngineOptions): CompositeRegime;
/**
 * Compare two regimes and return the dimensions that differ.
 * Useful for detecting regime transitions.
 */
export declare function diffRegimes(a: CompositeRegime, b: CompositeRegime): string[];
//# sourceMappingURL=engine.d.ts.map