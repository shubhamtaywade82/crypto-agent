import { evaluateFvgOutcome as canonicalEvaluateFvgOutcome, DEFAULT_OUTCOME_CONFIG } from './outcome-evaluators.js';
/**
 * Evaluates forward outcomes for an FVG by delegating to the single canonical ZoneOutcome evaluator.
 * Guarantees identical semantics and single source of truth across all research pipelines.
 */
export function evaluateFvgOutcome(candles, fvg, options) {
    const config = {
        ...DEFAULT_OUTCOME_CONFIG,
        horizonCandles: options.horizonCandles,
        targetR: options.targetR ?? DEFAULT_OUTCOME_CONFIG.targetR,
        stopAtrMultiplier: options.stopAtrMultiplier ?? DEFAULT_OUTCOME_CONFIG.stopAtrMultiplier
    };
    return canonicalEvaluateFvgOutcome(fvg, candles, options.atr, config);
}
//# sourceMappingURL=fvg-outcomes.js.map