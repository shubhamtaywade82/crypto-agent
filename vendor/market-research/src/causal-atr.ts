import { Decimal } from 'decimal.js';
import type { Candle } from '@nemesis-oss/market-events';

/**
 * Calculates strictly causal Average True Range (ATR) as-of index without future candle leakage.
 */
export function calculateCausalAtr(
  candles: readonly Candle[],
  index: number,
  period: number = 14
): Decimal {
  if (candles.length === 0) return new Decimal(1);
  const clampedIdx = Math.min(candles.length - 1, Math.max(0, index));
  const lookback = Math.min(clampedIdx, period);
  if (lookback === 0) {
    const c = candles[clampedIdx]!;
    return Decimal.max(1e-8, c.high.minus(c.low));
  }

  let sum = new Decimal(0);
  for (let i = clampedIdx - lookback + 1; i <= clampedIdx; i++) {
    const curr = candles[i]!;
    const prev = candles[i - 1]!;
    const tr1 = curr.high.minus(curr.low);
    const tr2 = curr.high.minus(prev.close).abs();
    const tr3 = curr.low.minus(prev.close).abs();
    sum = sum.plus(Decimal.max(tr1, Decimal.max(tr2, tr3)));
  }

  return Decimal.max(1e-8, sum.dividedBy(lookback));
}
