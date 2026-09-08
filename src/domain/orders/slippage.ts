/**
 * Slippage primitives for the execution-quality contract (V3.1 P0-1).
 * Pure, deterministic, broker-agnostic.
 */

/** A fill that landed outside the expectedPrice ± maxSlippageBps band. */
export interface SlippageBreach {
  readonly expectedPrice: number;
  /** Marginal price of the breaching fill delta (not the running average). */
  readonly fillPrice: number;
  /** Signed so worse-than-intended is positive. */
  readonly slippageBps: number;
  readonly limitBps: number;
  readonly at: number;
  readonly filledQuantity: number;
  readonly orderedQuantity: number;
}

/** Slippage in bps, signed so WORSE than intended is positive. */
export const slippageBpsOf = (
  side: 'buy' | 'sell', price: number, expected: number
): number =>
  expected > 0 ? ((price - expected) / expected) * 10_000 * (side === 'buy' ? 1 : -1) : 0;

/**
 * Marginal price of the newest fill delta, derived from cumulative
 * averages: (newAvg*newQty − oldAvg*oldQty) / delta. Deterministic and
 * exact for any sequence of average-price broker folds.
 */
export const marginalFillPrice = (
  prevQty: number, prevAvg: number | undefined, newQty: number, newAvg: number
): number => {
  const delta = newQty - prevQty;
  if (delta <= 0) return Number.NaN;
  if (prevQty <= 0 || prevAvg === undefined) return newAvg;
  return (newAvg * newQty - prevAvg * prevQty) / delta;
};

/** True when the marginal fill breaches the tolerance band. */
export const breachesBand = (
  side: 'buy' | 'sell', marginal: number, expected: number, limitBps: number
): { readonly breach: boolean; readonly bps: number } => {
  const bps = slippageBpsOf(side, marginal, expected);
  return { breach: bps > limitBps, bps };
};
