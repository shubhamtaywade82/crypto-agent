import { describe, it, expect } from 'vitest';
import { Decimal } from 'decimal.js';
import type { Candle } from '@nemesis-oss/market-events';

import { computeEvidenceBalance } from '../src/balance.js';

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

describe('negative-evidence-system / computeEvidenceBalance', () => {
  it('computes evidence balance with positive and negative items', () => {
    const candles = makeCandles(300);
    const balance = computeEvidenceBalance({
      candles,
      symbol: 'BTCUSDT',
      timeframe: '15m',
      eventType: 'fvg',
      htf: '1h',
    });

    expect(balance.strategy).toContain('fvg');
    expect(balance.symbol).toBe('BTCUSDT');
    expect(Array.isArray(balance.positiveEvidence)).toBe(true);
    expect(Array.isArray(balance.negativeEvidence)).toBe(true);
    expect(typeof balance.netScore).toBe('number');
    expect(['proceed', 'caution', 'reject']).toContain(balance.recommendation);
  });

  it('produces human-readable descriptions on each evidence item', () => {
    const candles = makeCandles(300);
    const balance = computeEvidenceBalance({
      candles,
      symbol: 'BTCUSDT',
      timeframe: '15m',
      eventType: 'fvg',
    });

    for (const item of [...balance.positiveEvidence, ...balance.negativeEvidence]) {
      expect(item.label).toBeTruthy();
      expect(item.source).toBeTruthy();
      expect(item.description.length).toBeGreaterThan(0);
      expect(item.magnitude).toBeGreaterThanOrEqual(0);
    }
  });

  it('produces JSON-serializable output', () => {
    const candles = makeCandles(300);
    const balance = computeEvidenceBalance({
      candles,
      symbol: 'BTCUSDT',
      timeframe: '15m',
      eventType: 'fvg',
    });
    const json = JSON.stringify(balance);
    expect(json.length).toBeGreaterThan(0);
    expect(json).not.toMatch(/\{\}/);
  });
});
