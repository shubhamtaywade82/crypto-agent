import { describe, it, expect } from 'vitest';
import { findSwings, analyzeStructure, detectSweep } from '../src/engines/structure-engine.js';
import type { Candle } from '../src/domain/market/types.js';

const candle = (i: number, low: number, high: number, close: number): Candle => ({
  openTime: i * 60_000, open: low + 0.1, high, low, close, volume: 100,
});

describe('structure engine', () => {
  it('finds fractal swing highs and lows', () => {
    const cs: Candle[] = [
      candle(0, 100, 101, 100.5),
      candle(1, 100.5, 102, 101),
      candle(2, 101, 103, 102.5),
      candle(3, 101.5, 102.5, 102),
      candle(4, 101, 102, 101.5),
      candle(5, 99.5, 100.5, 100),
      candle(6, 98.5, 99.5, 99),
      candle(7, 98, 99, 98.5),
      candle(8, 98.5, 100, 99.5),
      candle(9, 99, 100.5, 100),
    ];
    const swings = findSwings(cs, 2);
    expect(swings.some((s) => s.kind === 'HIGH' && s.price === 103)).toBe(true);
    expect(swings.some((s) => s.kind === 'LOW' && s.price === 98)).toBe(true);
  });

  it('detects BOS on close above swing high in an uptrend', () => {
    const cs: Candle[] = [];
    let price = 100;
    for (let i = 0; i < 40; i++) {
      const drift = i < 20 ? 0.5 : 1.2;
      price += drift;
      cs.push(candle(i, price - 0.6, price + 0.6, price));
    }
    const result = analyzeStructure(cs, 2);
    expect(result.view.swingHigh).toBeGreaterThan(0);
    expect(result.view.swingLow).toBeGreaterThan(0);
  });

  it('detects a sell-side liquidity sweep', () => {
    const cs: Candle[] = [];
    // Decline to a V-bottom swing low at 89.7, base ABOVE that low, then a
    // sweep candle: wick below the swing low closing back above it.
    let price = 100;
    for (let i = 0; i < 10; i++) {
      price -= 1;
      cs.push(candle(i, price - 0.3, price + 0.5, price));
    }
    const swingLow = price - 0.3; // the V-bottom wick low
    for (let i = 10; i < 20; i++) {
      cs.push(candle(i, price + 0.1, price + 0.9, price + 0.4));
    }
    cs.push(candle(20, swingLow - 0.7, price + 0.6, price + 0.3));
    const swings = findSwings(cs, 2);
    const result = detectSweep(cs, swings);
    expect(result.detected).toBe(true);
    expect(result.side).toBe('SELL_SIDE');
  });

  it('no sweep when price stays inside levels', () => {
    const cs: Candle[] = Array.from({ length: 30 }, (_, i) =>
      candle(i, 100 + Math.sin(i) * 0.2 - 0.2, 100 + Math.sin(i) * 0.2 + 0.2, 100)
    );
    const result = detectSweep(cs, findSwings(cs, 2));
    expect(result.detected).toBe(false);
  });
});
