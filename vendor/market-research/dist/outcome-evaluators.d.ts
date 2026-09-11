import { Decimal } from 'decimal.js';
import type { BaseEvent, Candle, FvgEvent, OrderBlockEvent, StructureBreakEvent, LiquiditySweepEvent } from '@nemesis-oss/market-events';
import type { OutcomeConfig, BaseOutcome, OrderBlockOutcome, StructureOutcome, LiquiditySweepOutcome, EventOutcome, ZoneOutcome } from './types.js';
import { evaluateGenericOutcome, DEFAULT_OUTCOME_CONFIG } from './generic-outcomes.js';
export { evaluateGenericOutcome, DEFAULT_OUTCOME_CONFIG };
export declare function evaluateFvgOutcome(event: FvgEvent, candles: readonly Candle[], causalAtr: Decimal, config?: OutcomeConfig): ZoneOutcome;
export declare function evaluateOrderBlockOutcome(event: OrderBlockEvent, candles: readonly Candle[], causalAtr: Decimal, config?: OutcomeConfig): OrderBlockOutcome;
export declare function evaluateStructureOutcome(event: StructureBreakEvent, candles: readonly Candle[], causalAtr: Decimal, config?: OutcomeConfig): StructureOutcome;
export declare function evaluateLiquiditySweepOutcome(event: LiquiditySweepEvent, candles: readonly Candle[], causalAtr: Decimal, config?: OutcomeConfig): LiquiditySweepOutcome;
export interface OutcomeEvaluator<E extends BaseEvent = BaseEvent, O extends BaseOutcome = BaseOutcome> {
    supports(event: BaseEvent): boolean;
    evaluate(event: E, candles: readonly Candle[], causalAtr: Decimal, config?: OutcomeConfig): O;
}
export declare function evaluateEventOutcome(event: BaseEvent, candles: readonly Candle[], causalAtr: Decimal, config?: OutcomeConfig): EventOutcome;
//# sourceMappingURL=outcome-evaluators.d.ts.map