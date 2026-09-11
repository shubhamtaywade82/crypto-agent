import { describe, expect, it } from 'vitest';
import { toMiCandles, toMiTimeframe } from '../src/engines/mi-candle-adapter.js';

describe('mi-candle-adapter', () => {
  it('converts kernel candles to Decimal market-intelligence format', () => {
    const mi = toMiCandles([{
      openTime: 1_700_000_000_000,
      open: 100, high: 105, low: 99, close: 103, volume: 42,
    }]);
    expect(mi[0]?.timestamp).toBe(1_700_000_000_000);
    expect(mi[0]?.close.toNumber()).toBe(103);
    expect(mi[0]?.volume.toNumber()).toBe(42);
  });

  it('maps supported kernel timeframes', () => {
    expect(toMiTimeframe('1h')).toBe('1h');
    expect(toMiTimeframe('4h')).toBe('4h');
  });
});
