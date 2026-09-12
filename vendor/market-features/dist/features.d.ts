import type { Candle } from '@nemesis-oss/market-events';
/**
 * A feature vector computed at a candle index. All values are full-precision
 * Decimal strings for JSON safety.
 *
 * Features are organized into 4 groups:
 *  - Price: returns, ATR, range, momentum
 *  - Volume: volume delta, relative volume, CVD
 *  - Microstructure: spread, depth imbalance (from candle proxies)
 *  - Derivatives: OI change, funding, basis (from optional snapshots)
 */
export interface FeatureVector {
    readonly symbol: string;
    readonly candleIndex: number;
    readonly timestamp: number;
    readonly price: {
        readonly returns: string;
        readonly atr: string;
        readonly rangeRatio: string;
        readonly momentum: string;
    };
    readonly volume: {
        readonly volumeDelta: string;
        readonly relativeVolume: string;
        readonly cvd: string;
    };
    readonly microstructure: {
        readonly bodyRatio: string;
        readonly wickRatio: string;
        readonly spreadRatio: string;
    };
    readonly derivatives?: {
        readonly oiChange: string;
        readonly fundingRate: string;
    };
}
export interface DerivativesInput {
    readonly openInterest?: number | undefined;
    readonly prevOpenInterest?: number | undefined;
    readonly fundingRate?: number | undefined;
}
export interface FeatureOptions {
    readonly atrPeriod?: number;
    readonly volumeLookback?: number;
    readonly momentumLookback?: number;
}
/**
 * Compute a feature vector at a given candle index.
 *
 * Pure and deterministic: same candles + same index → same features.
 * No look-ahead: only uses candles[0..index].
 */
export declare function computeFeatures(candles: readonly Candle[], index: number, symbol: string, derivatives?: DerivativesInput, options?: FeatureOptions): FeatureVector;
//# sourceMappingURL=features.d.ts.map