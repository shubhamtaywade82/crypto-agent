import type { Candle, OrderBlockEvent, StructureBreakEvent, Timeframe } from './types.js';
export interface OrderBlockOptions {
    readonly symbol: string;
    readonly timeframe: Timeframe;
    readonly lookbackBars?: number;
}
/**
 * Detects Order Blocks anchored to confirmed structure breaks.
 * Bullish OB: last down-close candle before the upward structural break.
 * Bearish OB: last up-close candle before the downward structural break.
 */
export declare function detectOrderBlocks(candles: readonly Candle[], breaks: readonly StructureBreakEvent[], options: OrderBlockOptions): OrderBlockEvent[];
//# sourceMappingURL=order-block.d.ts.map