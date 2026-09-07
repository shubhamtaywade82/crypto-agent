import type { Candle } from '../domain/market/types.js';

export const sma = (values: readonly number[], period: number): number[] => {
  const out: number[] = [];
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i]!;
    if (i >= period) sum -= values[i - period]!;
    out.push(i >= period - 1 ? sum / period : Number.NaN);
  }
  return out;
};

export const ema = (values: readonly number[], period: number): number[] => {
  const k = 2 / (period + 1);
  const out: number[] = [];
  let prev = Number.NaN;
  for (let i = 0; i < values.length; i++) {
    if (i === period - 1) {
      prev = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
    } else if (i >= period) {
      prev = values[i]! * k + prev * (1 - k);
    }
    out.push(i >= period - 1 ? prev : Number.NaN);
  }
  return out;
};

/** Wilder RSI. */
export const rsi = (closes: readonly number[], period = 14): number[] => {
  const out: number[] = new Array(closes.length).fill(Number.NaN);
  if (closes.length <= period) return out;
  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= period; i++) {
    const d = closes[i]! - closes[i - 1]!;
    if (d >= 0) gain += d;
    else loss -= d;
  }
  let avgGain = gain / period;
  let avgLoss = loss / period;
  out[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  for (let i = period + 1; i < closes.length; i++) {
    const d = closes[i]! - closes[i - 1]!;
    const g = d > 0 ? d : 0;
    const l = d < 0 ? -d : 0;
    avgGain = (avgGain * (period - 1) + g) / period;
    avgLoss = (avgLoss * (period - 1) + l) / period;
    out[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  }
  return out;
};

export interface MacdResult {
  readonly macd: number[];
  readonly signal: number[];
  readonly hist: number[];
}

/** MACD(12, 26, 9). */
export const macd = (closes: readonly number[]): MacdResult => {
  const fast = ema(closes, 12);
  const slow = ema(closes, 26);
  const line = closes.map((_, i) =>
    Number.isNaN(fast[i]) || Number.isNaN(slow[i]) ? Number.NaN : fast[i]! - slow[i]!
  );
  const firstValid = line.findIndex((v) => !Number.isNaN(v));
  const compact = firstValid === -1 ? [] : line.slice(firstValid);
  const sig = ema(compact, 9);
  const signal = new Array(closes.length).fill(Number.NaN);
  const hist = new Array(closes.length).fill(Number.NaN);
  for (let i = 0; i < sig.length; i++) {
    if (!Number.isNaN(sig[i])) {
      signal[firstValid + i] = sig[i]!;
      hist[firstValid + i] = line[firstValid + i]! - sig[i]!;
    }
  }
  return { macd: line, signal, hist };
};

/** True series for ATR. */
const trueRanges = (candles: readonly Candle[]): number[] =>
  candles.map((c, i) => {
    if (i === 0) return c.high - c.low;
    const prevClose = candles[i - 1]!.close;
    return Math.max(c.high - c.low, Math.abs(c.high - prevClose), Math.abs(c.low - prevClose));
  });

/** Wilder ATR. */
export const atr = (candles: readonly Candle[], period = 14): number[] => {
  const tr = trueRanges(candles);
  const out: number[] = new Array(candles.length).fill(Number.NaN);
  if (candles.length < period) return out;
  let acc = 0;
  for (let i = 0; i < period; i++) acc += tr[i]!;
  out[period - 1] = acc / period;
  for (let i = period; i < candles.length; i++) {
    out[i] = (out[i - 1]! * (period - 1) + tr[i]!) / period;
  }
  return out;
};

/** Percentile rank of the last value within the series (0-100). */
export const percentileOfLast = (series: readonly number[]): number => {
  const valid = series.filter((v) => Number.isFinite(v));
  if (valid.length < 2) return 50;
  const last = valid[valid.length - 1]!;
  const below = valid.filter((v) => v < last).length;
  return (below / (valid.length - 1)) * 100;
};

export const lastValid = (series: readonly number[]): number => {
  for (let i = series.length - 1; i >= 0; i--) {
    if (Number.isFinite(series[i])) return series[i]!;
  }
  return Number.NaN;
};

export const lastTwoValid = (series: readonly number[]): [number, number] => {
  let found = 0;
  let a = Number.NaN;
  let b = Number.NaN;
  for (let i = series.length - 1; i >= 0 && found < 2; i--) {
    if (Number.isFinite(series[i])) {
      if (found === 0) a = series[i]!;
      else b = series[i]!;
      found++;
    }
  }
  return [a, b];
};
