import { Decimal } from 'decimal.js';
/**
 * Causal Liquidity Pool Manager: increments and updates pools strictly as swings are confirmed over time.
 * Completely eliminates future lookahead bias in liquidity pool clustering.
 */
export class CausalLiquidityPoolManager {
    pools = [];
    toleranceRatio;
    constructor(toleranceRatio = 0.0015) {
        this.toleranceRatio = toleranceRatio;
    }
    onSwingConfirmed(swing) {
        const isHigh = swing.type === 'high';
        const targetType = isHigh ? 'bsl' : 'ssl';
        const matching = this.pools.find(p => p.status === 'active' &&
            p.targetType === targetType &&
            p.price.minus(swing.price).abs().dividedBy(p.price).lte(this.toleranceRatio));
        if (matching) {
            const newTouch = matching.touchCount + 1;
            const poolType = isHigh
                ? (newTouch >= 3 ? 'cluster' : 'equal_highs')
                : (newTouch >= 3 ? 'cluster' : 'equal_lows');
            const updatedPrice = isHigh ? Decimal.max(matching.price, swing.price) : Decimal.min(matching.price, swing.price);
            const idx = this.pools.indexOf(matching);
            this.pools[idx] = {
                ...matching,
                price: updatedPrice,
                poolType,
                touchCount: newTouch,
                strength: 'composite',
                formationTime: swing.timestamp
            };
        }
        else {
            const poolType = isHigh ? 'single_high' : 'single_low';
            this.pools.push({
                poolId: `pool-${targetType}-${swing.timestamp}-${poolType}`,
                price: swing.price,
                targetType,
                poolType,
                strength: swing.strength ?? 'minor',
                firstObservedAt: swing.timestamp,
                confirmedAtIndex: swing.confirmedAtIndex,
                formationTime: swing.timestamp,
                touchCount: 1,
                source: 'swings',
                status: 'active'
            });
        }
    }
    getActivePools() {
        return this.pools.filter(p => p.status === 'active');
    }
    markSwept(poolId, timestamp, index) {
        const idx = this.pools.findIndex(p => p.poolId === poolId);
        if (idx >= 0) {
            this.pools[idx] = {
                ...this.pools[idx],
                status: 'swept',
                sweptAtTimestamp: timestamp,
                sweptByIndex: index
            };
        }
    }
    getAllPools() {
        return this.pools;
    }
}
/**
 * Builds liquidity pools causally from swings in historical confirmation order.
 */
export function buildLiquidityPools(swings, toleranceRatio = 0.0015) {
    const manager = new CausalLiquidityPoolManager(toleranceRatio);
    const sorted = [...swings].sort((a, b) => a.confirmedAtIndex - b.confirmedAtIndex);
    for (const s of sorted) {
        manager.onSwingConfirmed(s);
    }
    return [...manager.getAllPools()];
}
/**
 * Detects liquidity sweeps against liquidity pools with incremental causal state.
 */
export function detectLiquiditySweeps(candles, swings, options) {
    const tolerance = options.equalLevelToleranceRatio ?? 0.0015;
    const manager = new CausalLiquidityPoolManager(tolerance);
    const sweeps = [];
    const swingsByConfirmedIndex = new Map();
    for (const s of swings) {
        const list = swingsByConfirmedIndex.get(s.confirmedAtIndex) ?? [];
        list.push(s);
        swingsByConfirmedIndex.set(s.confirmedAtIndex, list);
    }
    for (let i = 0; i < candles.length; i++) {
        const candle = candles[i];
        // 1. Ingest swings confirmed at bar i
        const newlyConfirmed = swingsByConfirmedIndex.get(i);
        if (newlyConfirmed) {
            for (const s of newlyConfirmed) {
                manager.onSwingConfirmed(s);
            }
        }
        // 2. Check sweeps against active pools
        const activePools = manager.getActivePools();
        let deepestBsl = null;
        let deepestSsl = null;
        for (const pool of activePools) {
            if (pool.targetType === 'bsl') {
                if (candle.high.gt(pool.price) && candle.close.lte(pool.price)) {
                    if (!deepestBsl || candle.high.minus(pool.price).gt(deepestBsl.extreme.minus(deepestBsl.pool.price))) {
                        deepestBsl = { pool, extreme: candle.high };
                    }
                }
            }
            else {
                if (candle.low.lt(pool.price) && candle.close.gte(pool.price)) {
                    if (!deepestSsl || pool.price.minus(candle.low).gt(deepestSsl.pool.price.minus(deepestSsl.extreme))) {
                        deepestSsl = { pool, extreme: candle.low };
                    }
                }
            }
        }
        if (deepestBsl) {
            manager.markSwept(deepestBsl.pool.poolId, candle.timestamp, i);
            sweeps.push({
                id: `${options.symbol}-${options.timeframe}-sweep-bsl-${candle.timestamp}`,
                type: 'liquidity_sweep',
                symbol: options.symbol,
                timeframe: options.timeframe,
                detectedAt: candle.timestamp,
                originIndex: i,
                originTimestamp: deepestBsl.pool.formationTime,
                availableAtIndex: i,
                availableAtTimestamp: candle.timestamp,
                timeline: {
                    originIndex: i,
                    originTimestamp: deepestBsl.pool.formationTime,
                    formedAtIndex: i,
                    formedAtTimestamp: deepestBsl.pool.formationTime,
                    confirmedAtIndex: i,
                    confirmedAtTimestamp: candle.timestamp,
                    availableAtIndex: i,
                    availableAtTimestamp: candle.timestamp
                },
                direction: 'bearish',
                sweptLevel: deepestBsl.pool.price,
                sweepExtreme: deepestBsl.extreme,
                targetType: 'bsl',
                reclaimed: true,
                poolId: deepestBsl.pool.poolId,
                poolType: deepestBsl.pool.poolType,
                penetrationTicks: deepestBsl.extreme.minus(deepestBsl.pool.price)
            });
        }
        if (deepestSsl) {
            manager.markSwept(deepestSsl.pool.poolId, candle.timestamp, i);
            sweeps.push({
                id: `${options.symbol}-${options.timeframe}-sweep-ssl-${candle.timestamp}`,
                type: 'liquidity_sweep',
                symbol: options.symbol,
                timeframe: options.timeframe,
                detectedAt: candle.timestamp,
                originIndex: i,
                originTimestamp: deepestSsl.pool.formationTime,
                availableAtIndex: i,
                availableAtTimestamp: candle.timestamp,
                timeline: {
                    originIndex: i,
                    originTimestamp: deepestSsl.pool.formationTime,
                    formedAtIndex: i,
                    formedAtTimestamp: deepestSsl.pool.formationTime,
                    confirmedAtIndex: i,
                    confirmedAtTimestamp: candle.timestamp,
                    availableAtIndex: i,
                    availableAtTimestamp: candle.timestamp
                },
                direction: 'bullish',
                sweptLevel: deepestSsl.pool.price,
                sweepExtreme: deepestSsl.extreme,
                targetType: 'ssl',
                reclaimed: true,
                poolId: deepestSsl.pool.poolId,
                poolType: deepestSsl.pool.poolType,
                penetrationTicks: deepestSsl.pool.price.minus(deepestSsl.extreme)
            });
        }
    }
    return sweeps;
}
//# sourceMappingURL=liquidity.js.map