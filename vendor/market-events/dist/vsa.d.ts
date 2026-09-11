import { Decimal } from 'decimal.js';
import type { Candle, Timeframe, VsaEvent } from './types.js';
export interface VsaOptions {
    readonly symbol: string;
    readonly timeframe: Timeframe;
    readonly lookback?: number;
    readonly highVolumeThreshold?: Decimal;
    readonly lowVolumeThreshold?: Decimal;
}
/**
 * Detects Volume Spread Analysis (VSA) events deterministically from candle spread and relative volume.
 */
export declare function detectVsaEvents(candles: readonly Candle[], options: VsaOptions): VsaEvent[];
//# sourceMappingURL=vsa.d.ts.map