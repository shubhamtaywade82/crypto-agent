import type { Candle, Timeframe } from '@nemesis-oss/market-events';
/**
 * A single piece of evidence — either positive or negative.
 */
export interface EvidenceItem {
    readonly label: string;
    readonly magnitude: number;
    readonly direction: 'positive' | 'negative';
    readonly source: string;
    readonly description: string;
}
/**
 * The evidence balance for a strategy/hypothesis.
 *
 * Combines the positive edge (uplift over baseline) with the negative
 * evidence (HTF conflict, early failure, invalidated zones) to produce
 * a net evidence score.
 *
 * Example:
 *   FVG strategy
 *   Positive: +12% relative uplift
 *   Negative: -18% during high volatility
 *            -11% with HTF conflict
 *            -9% after liquidity sweep failure
 *   Net: -26% (strategy is net negative when accounting for negative evidence)
 */
export interface EvidenceBalance {
    readonly strategy: string;
    readonly symbol: string;
    readonly timeframe: string;
    readonly eventType: string;
    readonly positiveEvidence: readonly EvidenceItem[];
    readonly negativeEvidence: readonly EvidenceItem[];
    readonly netScore: number;
    readonly recommendation: 'proceed' | 'caution' | 'reject';
    readonly computedAt: number;
}
export interface EvidenceBalanceOptions {
    readonly candles: readonly Candle[];
    readonly symbol: string;
    readonly timeframe: Timeframe;
    readonly eventType: string;
    readonly htf?: Timeframe;
    readonly horizonCandles?: number;
}
/**
 * Compute the evidence balance for a strategy.
 *
 * Combines:
 *  - Positive: baseline uplift, FDR significance, OOS stability
 *  - Negative: HTF conflict penalty, early failure rate, invalidated zone rate
 *
 * The net score is the sum of all positive and negative items.
 * A positive net score → 'proceed'; near zero → 'caution'; negative → 'reject'.
 */
export declare function computeEvidenceBalance(options: EvidenceBalanceOptions): EvidenceBalance;
//# sourceMappingURL=balance.d.ts.map