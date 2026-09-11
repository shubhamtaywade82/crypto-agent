import { Decimal } from 'decimal.js';
import type { Candle, StructureBreakEvent, SwingPoint } from '@nemesis-oss/market-events';
import type { ContextSnapshot, MarketSession } from './types.js';
import { type HtfCandlesMap } from './multi-timeframe.js';
export type TrendRegime = 'bullish' | 'bearish' | 'range';
export type VolatilityRegime = 'low' | 'normal' | 'high';
export interface MarketContextFeatures {
    readonly trendRegime: TrendRegime;
    readonly volatilityRegime: VolatilityRegime;
    readonly atr: Decimal;
    readonly displacementAtr: Decimal;
    readonly session?: MarketSession | undefined;
}
export declare function estimateIndependentTrendRegime(candles: readonly Candle[], index: number, period?: number): TrendRegime;
/**
 * Extracts context features (trend, volatility, displacement, session) at a specific candle index.
 */
export declare function extractContextFeatures(candles: readonly Candle[], currentIndex: number, swings?: readonly SwingPoint[], breaks?: readonly StructureBreakEvent[]): MarketContextFeatures;
export declare function extractContextSnapshot(candles: readonly Candle[], currentIndex: number, htfCandlesMap?: HtfCandlesMap): ContextSnapshot;
//# sourceMappingURL=context-features.d.ts.map