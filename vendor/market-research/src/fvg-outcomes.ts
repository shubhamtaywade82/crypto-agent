import { Decimal } from 'decimal.js';
import type { Candle, FvgEvent } from '@nemesis-oss/market-events';
import type { ZoneOutcome, OutcomeConfig } from './types.js';
import { evaluateFvgOutcome as canonicalEvaluateFvgOutcome, DEFAULT_OUTCOME_CONFIG } from './outcome-evaluators.js';

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
export function evaluateFvgOutcome(
  candles: readonly Candle[],
  fvg: FvgEvent,
  options: FvgOutcomeOptions
): ZoneOutcome {
  const config: OutcomeConfig = {
    ...DEFAULT_OUTCOME_CONFIG,
    horizonCandles: options.horizonCandles,
    targetR: options.targetR ?? DEFAULT_OUTCOME_CONFIG.targetR,
    stopAtrMultiplier: options.stopAtrMultiplier ?? DEFAULT_OUTCOME_CONFIG.stopAtrMultiplier
  };
  return canonicalEvaluateFvgOutcome(fvg, candles, options.atr, config);
}
