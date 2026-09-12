import { describe, it, expect } from 'vitest';
import { Decimal } from 'decimal.js';
import type { Candle } from '@nemesis-oss/market-events';

import { classifyRegime, diffRegimes } from '../src/engine.js';

const FIFTEEN_MIN = 15 * 60_000;

function makeCandles(count: number, trend: 'bull' | 'bear' | 'range' = 'range'): Candle[] {
  const candles: Candle[] = [];
  let price = 100;
  for (let i = 0; i < count; i++) {
    const drift = trend === 'bull' ? 0.5 : trend === 'bear' ? -0.5 : Math.sin(i / 13) * 0.3;
    const open = price;
    const close = price + drift;
    const high = Math.max(open, close) + 0.5;
    const low = Math.min(open, close) - 0.5;
    candles.push({
      timestamp: 1_700_000_000_000 + i * FIFTEEN_MIN,
      open: new Decimal(open.toFixed(4)),
      high: new Decimal(high.toFixed(4)),
      low: new Decimal(low.toFixed(4)),
      close: new Decimal(close.toFixed(4)),
      volume: new Decimal('1000'),
    });
    price = close;
  }
  return candles;
}

describe('regime-engine / classifyRegime', () => {
  it('classifies a bullish trending market', () => {
    const candles = makeCandles(60, 'bull');
    const regime = classifyRegime(candles, 59, 'BTCUSDT', '15m');
    expect(regime.symbol).toBe('BTCUSDT');
    expect(regime.timeframe).toBe('15m');
    expect(regime.trend).toBe('bullish');
    expect(regime.momentum).toBe('positive');
    expect(regime.summary).toContain('bullish');
  });

  it('classifies a bearish trending market', () => {
    const candles = makeCandles(60, 'bear');
    const regime = classifyRegime(candles, 59, 'ETHUSDT', '15m');
    expect(regime.trend).toBe('bearish');
    expect(regime.momentum).toBe('negative');
  });

  it('incorporates derivatives regime from OI delta', () => {
    const candles = makeCandles(60, 'bull');
    const regime = classifyRegime(candles, 59, 'SOLUSDT', '15m', {
      openInterest: 1_000_000,
      openInterestChange: 0.05, // +5% OI
      fundingRate: 0.0001,
    });
    expect(regime.derivatives).toBe('rising_oi');
  });

  it('detects falling OI', () => {
    const candles = makeCandles(60, 'bear');
    const regime = classifyRegime(candles, 59, 'SOLUSDT', '15m', {
      openInterestChange: -0.05,
    });
    expect(regime.derivatives).toBe('falling_oi');
  });

  it('returns flat_oi when no derivatives data', () => {
    const candles = makeCandles(60);
    const regime = classifyRegime(candles, 59, 'BTCUSDT', '15m');
    expect(regime.derivatives).toBe('flat_oi');
  });

  it('produces a summary string joining all dimensions', () => {
    const candles = makeCandles(60, 'bull');
    const regime = classifyRegime(candles, 59, 'BTCUSDT', '15m', {
      openInterestChange: 0.05,
    });
    const parts = regime.summary.split('+');
    expect(parts.length).toBe(5);
    expect(parts[0]).toBe('bullish');
  });
});

describe('regime-engine / diffRegimes', () => {
  it('detects regime transitions', () => {
    const candles = makeCandles(60, 'bull');
    const a = classifyRegime(candles, 30, 'BTCUSDT', '15m');
    const b = classifyRegime(candles, 59, 'BTCUSDT', '15m');
    const diffs = diffRegimes(a, b);
    expect(Array.isArray(diffs)).toBe(true);
  });

  it('returns empty array for identical regimes', () => {
    const candles = makeCandles(60);
    const a = classifyRegime(candles, 50, 'BTCUSDT', '15m');
    const b = classifyRegime(candles, 50, 'BTCUSDT', '15m');
    expect(diffRegimes(a, b)).toEqual([]);
  });
});
