import { Decimal } from 'decimal.js';
import type { BaseEvent, Candle } from '@nemesis-oss/market-events';
import type { OutcomeConfig, BaseOutcome, DirectionalOutcome, PathResolution, TradeExecutionOutcome, OutcomeLabel } from './types.js';
export declare const DEFAULT_OUTCOME_CONFIG: OutcomeConfig;
interface TrajectoryResult {
    readonly mfe: Decimal;
    readonly mae: Decimal;
    readonly firstHit: BaseOutcome['firstHit'];
    readonly timeToFirstHitBars: number;
    readonly isAmbiguous: boolean;
    readonly pathResolution: PathResolution;
    readonly collision: boolean;
    readonly targetFirst: boolean;
    readonly stopFirst: boolean;
    readonly stopHit: boolean;
    readonly timeToTarget: number | null;
    readonly timeToStop: number | null;
    readonly timeTo1R: number | null;
    readonly timeTo2R: number | null;
    readonly timeTo3R: number | null;
}
export declare function resolveCollision(policy: OutcomeConfig['ambiguityPolicy']): BaseOutcome['firstHit'];
export interface TrajectoryParams {
    readonly entry: Decimal;
    readonly direction: 'bullish' | 'bearish';
    readonly atr: Decimal;
    readonly config: OutcomeConfig;
    readonly startOffset?: number | undefined;
    readonly lowerTfCandles?: readonly Candle[] | undefined;
}
export declare function evaluateTrajectory(candles: readonly Candle[], params: TrajectoryParams): TrajectoryResult;
export declare function buildOutcomeLabel(evalIndex: number, horizonCandles: number, candles: readonly Candle[]): OutcomeLabel;
export declare function evaluateGenericOutcome(event: BaseEvent, candles: readonly Candle[], causalAtr: Decimal, config?: OutcomeConfig): DirectionalOutcome;
export interface TradeSimulationConfig {
    readonly feeBps?: number | undefined;
}
/**
 * Pure execution simulator that computes realized P&L, fees, and execution metrics from an outcome.
 */
export declare function simulateTradeExecution(outcome: BaseOutcome, entryPrice: Decimal, riskAmount: Decimal, config?: TradeSimulationConfig): TradeExecutionOutcome;
export {};
//# sourceMappingURL=generic-outcomes.d.ts.map