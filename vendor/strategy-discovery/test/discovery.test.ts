import { describe, it, expect } from 'vitest';
import { Decimal } from 'decimal.js';
import type { Candle } from '@nemesis-oss/market-events';

import { discoverStrategies } from '../src/discovery.js';

const FIFTEEN_MIN = 15 * 60_000;

function makeCandles(count: number): Candle[] {
  const candles: Candle[] = [];
  let price = 100;
  for (let i = 0; i < count; i++) {
    const drift = Math.sin(i / 13) * 0.8 + Math.sin(i / 47) * 0.4;
    const open = price;
    const close = price + drift + (i % 7 === 0 ? -2.5 : 0);
    const high = Math.max(open, close) + Math.abs(Math.sin(i / 3)) * 1.2;
    const low = Math.min(open, close) - Math.abs(Math.cos(i / 3)) * 1.2;
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

describe('strategy-discovery / discoverStrategies', () => {
  it('discovers strategy candidates from event types', () => {
    const candles = makeCandles(300);
    const candidates = discoverStrategies({
      candles,
      symbol: 'BTCUSDT',
      timeframe: '15m',
      eventTypes: ['fvg', 'bos', 'displacement'],
      horizonCandles: 24,
    });

    expect(Array.isArray(candidates)).toBe(true);
    // Each candidate should have the full structure.
    for (const c of candidates) {
      expect(c.id).toMatch(/^strat-/);
      expect(c.entryConditions.length).toBeGreaterThan(0);
      expect(c.targetModel.targetR).toBe(2);
      expect(c.robustness.score).toBeGreaterThanOrEqual(0);
      expect(c.robustness.score).toBeLessThanOrEqual(1);
      expect(['high', 'medium', 'low']).toContain(c.robustness.level);
    }
  });

  it('applies regime filters and produces context conditions', () => {
    const candles = makeCandles(300);
    const candidates = discoverStrategies({
      candles,
      symbol: 'BTCUSDT',
      timeframe: '15m',
      eventTypes: ['fvg'],
      regimeFilters: [{ trend: 'bullish' }, { trend: 'bearish' }],
      horizonCandles: 24,
    });

    for (const c of candidates) {
      expect(c.contextConditions.length).toBeGreaterThan(0);
      expect(c.contextConditions.some((cond) => cond.field === 'trendRegime')).toBe(true);
    }
  });

  it('sorts candidates by robustness score descending', () => {
    const candles = makeCandles(400);
    const candidates = discoverStrategies({
      candles,
      symbol: 'BTCUSDT',
      timeframe: '15m',
      eventTypes: ['fvg', 'bos', 'choch', 'mss', 'displacement'],
    });

    for (let i = 1; i < candidates.length; i++) {
      expect(candidates[i - 1]!.robustness.score).toBeGreaterThanOrEqual(
        candidates[i]!.robustness.score,
      );
    }
  });

  it('produces JSON-serializable candidates', () => {
    const candles = makeCandles(300);
    const candidates = discoverStrategies({
      candles,
      symbol: 'BTCUSDT',
      timeframe: '15m',
      eventTypes: ['fvg'],
    });
    for (const c of candidates) {
      const json = JSON.stringify(c);
      expect(json.length).toBeGreaterThan(0);
      expect(json).not.toMatch(/\{\}/);
    }
  });
});
