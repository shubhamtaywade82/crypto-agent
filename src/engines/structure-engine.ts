import type { Candle, StructureView, Trend } from '../domain/market/types.js';

export interface SwingPoint {
  readonly index: number;
  readonly price: number;
  readonly kind: 'HIGH' | 'LOW';
  readonly time: number;
}

/** Fractal pivot detection with `k` candles on each side. */
export const findSwings = (candles: readonly Candle[], k = 2): SwingPoint[] => {
  const swings: SwingPoint[] = [];
  for (let i = k; i < candles.length - k; i++) {
    const c = candles[i]!;
    let isHigh = true;
    let isLow = true;
    for (let j = i - k; j <= i + k; j++) {
      if (j === i) continue;
      const other = candles[j]!;
      if (other.high >= c.high) isHigh = false;
      if (other.low <= c.low) isLow = false;
    }
    if (isHigh) swings.push({ index: i, price: c.high, kind: 'HIGH', time: c.openTime });
    if (isLow) swings.push({ index: i, price: c.low, kind: 'LOW', time: c.openTime });
  }
  return swings.sort((a, b) => a.index - b.index);
};

/** Determine trend from swing sequence: higher-highs/higher-lows vs opposite. */
export const trendFromSwings = (swings: readonly SwingPoint[]): Trend => {
  const highs = swings.filter((s) => s.kind === 'HIGH').slice(-3);
  const lows = swings.filter((s) => s.kind === 'LOW').slice(-3);
  if (highs.length < 2 || lows.length < 2) return 'RANGE';
  const hh = highs[highs.length - 1]!.price > highs[highs.length - 2]!.price;
  const hl = lows[lows.length - 1]!.price > lows[lows.length - 2]!.price;
  const lh = highs[highs.length - 1]!.price < highs[highs.length - 2]!.price;
  const ll = lows[lows.length - 1]!.price < lows[lows.length - 2]!.price;
  if (hh && hl) return 'BULLISH';
  if (lh && ll) return 'BEARISH';
  return 'RANGE';
};

export interface StructureResult {
  readonly view: StructureView;
  readonly swings: readonly SwingPoint[];
  readonly lastClose: number;
}

/**
 * SMC-style structure: BOS = close beyond last swing in trend direction,
 * CHoCH = close beyond last swing against prior trend.
 */
export const analyzeStructure = (candles: readonly Candle[], k = 2): StructureResult => {
  const swings = findSwings(candles, k);
  const trend = trendFromSwings(swings);
  const lastHigh = [...swings].reverse().find((s) => s.kind === 'HIGH');
  const lastLow = [...swings].reverse().find((s) => s.kind === 'LOW');
  const last = candles[candles.length - 1];
  const close = last ? last.close : Number.NaN;
  const lastSwing = !lastHigh && !lastLow
    ? 'NONE'
    : lastHigh && lastLow
      ? (lastHigh.index > lastLow.index ? 'HIGH' : 'LOW')
      : lastHigh ? 'HIGH' : 'LOW';

  const swingHigh = lastHigh?.price ?? (last ? last.high : Number.NaN);
  const swingLow = lastLow?.price ?? (last ? last.low : Number.NaN);

  const bos =
    (trend === 'BULLISH' && close > swingHigh) ||
    (trend === 'BEARISH' && close < swingLow);
  const choch =
    (trend === 'BULLISH' && close < swingLow) ||
    (trend === 'BEARISH' && close > swingHigh);

  return {
    view: {
      trend,
      bos,
      choch,
      swingHigh,
      swingLow,
      lastSwing: lastSwing as StructureView['lastSwing'],
    },
    swings,
    lastClose: close,
  };
};

/** Recent N swing highs above price and swing lows below price. */
export const liquidityLevels = (
  swings: readonly SwingPoint[],
  price: number
): { nearestHigh: number; nearestLow: number } => {
  const highs = swings.filter((s) => s.kind === 'HIGH' && s.price > price);
  const lows = swings.filter((s) => s.kind === 'LOW' && s.price < price);
  const nearestHigh = highs.length ? Math.min(...highs.map((s) => s.price)) : price * 1.02;
  const nearestLow = lows.length ? Math.max(...lows.map((s) => s.price)) : price * 0.98;
  return { nearestHigh, nearestLow };
};

/**
 * Liquidity sweep: price wicked beyond a swing level then closed back
 * inside within the same or next candle.
 */
export const detectSweep = (
  candles: readonly Candle[],
  swings: readonly SwingPoint[]
): { detected: boolean; side: 'BUY_SIDE' | 'SELL_SIDE' | 'NONE' } => {
  if (candles.length < 3) return { detected: false, side: 'NONE' };
  const last = candles[candles.length - 1]!;
  const prior = candles.slice(0, -1);
  const sellSide = swings.some(
    (s) => s.kind === 'LOW' && last.low < s.price && last.close > s.price &&
      prior.some((c) => c.low >= s.price)
  );
  if (sellSide) return { detected: true, side: 'SELL_SIDE' };
  const buySide = swings.some(
    (s) => s.kind === 'HIGH' && last.high > s.price && last.close < s.price &&
      prior.some((c) => c.high <= s.price)
  );
  if (buySide) return { detected: true, side: 'BUY_SIDE' };
  return { detected: false, side: 'NONE' };
};
