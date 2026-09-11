import type { Candle, LiquidityPool, LiquiditySweepEvent, SwingPoint, Timeframe } from './types.js';
export interface SweepOptions {
    readonly symbol: string;
    readonly timeframe: Timeframe;
    readonly equalLevelToleranceRatio?: number;
}
/**
 * Causal Liquidity Pool Manager: increments and updates pools strictly as swings are confirmed over time.
 * Completely eliminates future lookahead bias in liquidity pool clustering.
 */
export declare class CausalLiquidityPoolManager {
    private pools;
    private readonly toleranceRatio;
    constructor(toleranceRatio?: number);
    onSwingConfirmed(swing: SwingPoint): void;
    getActivePools(): readonly LiquidityPool[];
    markSwept(poolId: string, timestamp: number, index: number): void;
    getAllPools(): readonly LiquidityPool[];
}
/**
 * Builds liquidity pools causally from swings in historical confirmation order.
 */
export declare function buildLiquidityPools(swings: readonly SwingPoint[], toleranceRatio?: number): LiquidityPool[];
/**
 * Detects liquidity sweeps against liquidity pools with incremental causal state.
 */
export declare function detectLiquiditySweeps(candles: readonly Candle[], swings: readonly SwingPoint[], options: SweepOptions): LiquiditySweepEvent[];
//# sourceMappingURL=liquidity.d.ts.map