import { Decimal } from 'decimal.js';
import type { Candle, FvgEvent } from '@nemesis-oss/market-events';
import type { ZoneOutcome } from './types.js';
export interface FvgOutcomeOptions {
    readonly horizonCandles: number;
    readonly atr: Decimal;
    readonly targetR?: number | undefined;
    readonly stopAtrMultiplier?: number | undefined;
}
/**
 * Evaluates forward outcomes for an FVG by delegating to the single canonical ZoneOutcome evaluator.
 * Guarantees identical semantics and single source of truth across all research pipelines.
 */
export declare function evaluateFvgOutcome(candles: readonly Candle[], fvg: FvgEvent, options: FvgOutcomeOptions): ZoneOutcome;
//# sourceMappingURL=fvg-outcomes.d.ts.map