import { Decimal } from 'decimal.js';
import type { BaseEvent, Candle } from '@nemesis-oss/market-events';
import type { DirectionalOutcome, OutcomeConfig } from './types.js';
export interface MatchedControlObservation {
    readonly matchedEventId: string;
    readonly controlOriginIndex: number;
    readonly direction: 'bullish' | 'bearish';
    readonly causalAtr: Decimal;
    readonly outcome: DirectionalOutcome;
}
export interface MatchOptions {
    readonly searchRadiusBars?: number;
    readonly maxAtrDeviationRatio?: number;
    readonly matchTrendRegime?: boolean;
    readonly matchSession?: boolean;
}
export interface MatchedControlResultSet extends Array<MatchedControlObservation> {
    readonly matchRatio: number;
    readonly matchedCount: number;
    readonly totalEvents: number;
}
/**
 * Finds eligible non-event control candle indices for a given event,
 * matching on timeframe, direction, volatility bucket, temporal proximity,
 * and optionally stratifying by trend regime and trading session.
 */
export declare function findMatchedControlIndex(event: BaseEvent, candles: readonly Candle[], unavailableIndices: ReadonlySet<number>, options?: MatchOptions): number | null;
/**
 * Generates direction-aware, volatility-matched control observations for an event population.
 * Strictly enforces 1:1 matching without replacement and rejects contaminated fallback neighbors.
 */
export declare function generateMatchedControls(events: readonly BaseEvent[], candles: readonly Candle[], config?: OutcomeConfig, options?: MatchOptions): MatchedControlResultSet;
//# sourceMappingURL=matched-controls.d.ts.map