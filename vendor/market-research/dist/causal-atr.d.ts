import { Decimal } from 'decimal.js';
import type { Candle } from '@nemesis-oss/market-events';
/**
 * Calculates strictly causal Average True Range (ATR) as-of index without future candle leakage.
 */
export declare function calculateCausalAtr(candles: readonly Candle[], index: number, period?: number): Decimal;
//# sourceMappingURL=causal-atr.d.ts.map