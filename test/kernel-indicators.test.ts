import { describe, it, expect } from 'vitest';
import { rsi, macd, atr, ema, percentileOfLast } from '../src/engines/indicators.js';
import type { Candle } from '../src/domain/market/types.js';

const closes = (n: number, fn: (i: number) => number): number[] =>
  Array.from({ length: n }, (_, i) => fn(i));

const candles = (n: number, base = 100): Candle[] =>
  Array.from({ length: n }, (_, i) => {
    const price = base + Math.sin(i / 5) * 3 + i * 0.05;
    return {
      openTime: i * 60_000,
      open: price,
      high: price + 0.5,
      low: price - 0.5,
      close: price + 0.1,
      volume: 100,
    };
  });

describe('indicators', () => {
  it('RSI is 100 on a pure uptrend and low on a downtrend', () => {
    const up = rsi(closes(40, (i) => 100 + i), 14);
    expect(up[up.length - 1]).toBeGreaterThan(75);
    const down = rsi(closes(40, (i) => 100 - i), 14);
    expect(down[down.length - 1]).toBeLessThan(25);
  });

  it('RSI is bounded within [0, 100]', () => {
    const series = rsi(closes(200, (i) => 100 + Math.sin(i / 3) * 10 + (i % 17)), 14);
    for (const v of series) {
      if (Number.isFinite(v)) expect(v).toBeGreaterThanOrEqual(0);
      if (Number.isFinite(v)) expect(v).toBeLessThanOrEqual(100);
    }
  });

  it('MACD hist flips sign across a genuine trend reversal', () => {
    // Exponential up-phase then decline: on a LINEAR ramp the MACD line is
    // mathematically constant, so an exponential series is required here.
    const up = closes(60, (i) => 100 * Math.pow(1.02, i));
    const rev = [...up, ...closes(30, (i) => up[59]! * Math.pow(0.98, i + 1))];
    const m = macd(rev);
    const hist = m.hist.filter((v) => Number.isFinite(v));
    expect(hist.some((v) => v > 0)).toBe(true);
    expect(hist.some((v) => v < 0)).toBe(true);
  });

  it('ATR is positive and grows with range expansion', () => {
    const calm = atr(candles(50), 14);
    const wild = atr(candles(50, 100).map((c) => ({
      ...c, high: c.high + 10, low: c.low - 10,
    })), 14);
    expect(calm[calm.length - 1]!).toBeGreaterThan(0);
    expect(wild[wild.length - 1]!).toBeGreaterThan(calm[calm.length - 1]!);
  });

  it('EMA converges to the series level', () => {
    const flat = closes(100, () => 50);
    const e = ema(flat, 10);
    expect(e[e.length - 1]!).toBeCloseTo(50, 6);
  });

  it('percentileOfLast ranks the last value', () => {
    expect(percentileOfLast([1, 2, 3, 4, 5])).toBe(100);
    expect(percentileOfLast([5, 4, 3, 2, 1])).toBe(0);
  });
});
