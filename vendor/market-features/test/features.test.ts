import { describe, it, expect } from 'vitest';
import { Decimal } from 'decimal.js';
import type { Candle } from '@nemesis-oss/market-events';

import { computeFeatures } from '../src/features.js';

function makeCandles(count: number): Candle[] {
  const candles: Candle[] = [];
  let price = 100;
  for (let i = 0; i < count; i++) {
    const drift = Math.sin(i / 13) * 0.5;
    const open = price;
    const close = price + drift;
    const high = Math.max(open, close) + 0.3;
    const low = Math.min(open, close) - 0.3;
    candles.push({
      timestamp: 1_700_000_000_000 + i * 60_000,
      open: new Decimal(open.toFixed(4)),
      high: new Decimal(high.toFixed(4)),
      low: new Decimal(low.toFixed(4)),
      close: new Decimal(close.toFixed(4)),
      volume: new Decimal((1000 + i * 10).toString()),
    });
    price = close;
  }
  return candles;
}

describe('market-features / computeFeatures', () => {
  it('computes price features with Decimal-precision strings', () => {
    const candles = makeCandles(50);
    const f = computeFeatures(candles, 49, 'BTCUSDT');
    expect(f.symbol).toBe('BTCUSDT');
    expect(f.candleIndex).toBe(49);
    expect(typeof f.price.returns).toBe('string');
    expect(typeof f.price.atr).toBe('string');
    expect(typeof f.price.rangeRatio).toBe('string');
    expect(typeof f.price.momentum).toBe('string');
    // No '{}' from unserialized Decimal.
    expect(f.price.atr).not.toBe('{}');
  });

  it('computes volume features including CVD', () => {
    const candles = makeCandles(50);
    const f = computeFeatures(candles, 49, 'BTCUSDT');
    expect(typeof f.volume.volumeDelta).toBe('string');
    expect(typeof f.volume.relativeVolume).toBe('string');
    expect(typeof f.volume.cvd).toBe('string');
    // CVD should be a valid number string.
    expect(Number(f.volume.cvd)).not.toBeNaN();
  });

  it('computes microstructure features from OHLC', () => {
    const candles = makeCandles(50);
    const f = computeFeatures(candles, 49, 'BTCUSDT');
    const bodyRatio = Number(f.microstructure.bodyRatio);
    const wickRatio = Number(f.microstructure.wickRatio);
    expect(bodyRatio).toBeGreaterThanOrEqual(0);
    expect(bodyRatio).toBeLessThanOrEqual(1);
    expect(wickRatio).toBeGreaterThanOrEqual(0);
    expect(bodyRatio + wickRatio).toBeCloseTo(1, 5);
  });

  it('includes derivatives when OI data is supplied', () => {
    const candles = makeCandles(50);
    const f = computeFeatures(candles, 49, 'BTCUSDT', {
      openInterest: 1_050_000,
      prevOpenInterest: 1_000_000,
      fundingRate: 0.0001,
    });
    expect(f.derivatives).toBeDefined();
    expect(Number(f.derivatives!.oiChange)).toBeCloseTo(0.05, 5);
    expect(Number(f.derivatives!.fundingRate)).toBeCloseTo(0.0001, 10);
  });

  it('omits derivatives when OI data is absent', () => {
    const candles = makeCandles(50);
    const f = computeFeatures(candles, 49, 'BTCUSDT');
    expect(f.derivatives).toBeUndefined();
  });

  it('produces JSON-serializable output', () => {
    const candles = makeCandles(50);
    const f = computeFeatures(candles, 49, 'BTCUSDT');
    const json = JSON.stringify(f);
    expect(json.length).toBeGreaterThan(0);
    expect(json).not.toMatch(/\{\}/);
  });

  it('throws on out-of-range index', () => {
    const candles = makeCandles(10);
    expect(() => computeFeatures(candles, 10, 'BTCUSDT')).toThrow(/out of range/);
    expect(() => computeFeatures(candles, -1, 'BTCUSDT')).toThrow(/out of range/);
  });
});
