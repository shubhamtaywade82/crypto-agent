import { Decimal } from 'decimal.js';
import type { Candle } from './types.js';
export interface VolumeProfileLevel {
    readonly price: Decimal;
    readonly volume: Decimal;
}
export interface VolumeProfileResult {
    readonly poc: Decimal;
    readonly vah: Decimal;
    readonly val: Decimal;
    readonly totalVolume: Decimal;
    readonly levels: readonly VolumeProfileLevel[];
}
export interface VolumeProfileOptions {
    readonly binSize: Decimal;
    readonly valueAreaRatio?: Decimal;
}
export declare function calculateVolumeProfile(candles: readonly Candle[], options: VolumeProfileOptions): VolumeProfileResult;
//# sourceMappingURL=volume-profile.d.ts.map