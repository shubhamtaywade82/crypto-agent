import { describe, expect, it } from 'vitest';
import type { Candle } from '../src/domain/market/types.js';
import { scanMiEventsOnClose } from '../src/engines/mi-event-scan.js';

const pad = (n: number, start = 100): Candle[] =>
  Array.from({ length: n }, (_, i) => ({
    openTime: i * 60_000,
    open: start + i * 0.01,
    high: start + i * 0.01 + 0.5,
    low: start + i * 0.01 - 0.5,
    close: start + i * 0.01 + 0.1,
    volume: 10,
  }));

const sweepTail = (): Candle[] => [
  { openTime: 20_000, open: 100, high: 105, low: 98, close: 102, volume: 10 },
  { openTime: 21_000, open: 102, high: 115, low: 101, close: 112, volume: 10 },
  { openTime: 22_000, open: 112, high: 110, low: 102, close: 105, volume: 10 },
  { openTime: 23_000, open: 105, high: 117, low: 104, close: 113, volume: 10 },
];

describe('scanMiEventsOnClose', () => {
  it('detects a fresh liquidity sweep on the last closed bar', () => {
    const candles = [...pad(16), ...sweepTail()];
    const fresh = scanMiEventsOnClose('BTCUSDT', '15m', candles, new Set());
    expect(fresh.some((e) => e.eventType === 'liquidity_sweep')).toBe(true);
    expect(fresh[0]?.label).toContain('sweep');
  });

  it('detects CHoCH on the last closed bar', () => {
    const chochTail: Candle[] = [
      { openTime: 20_000, open: 100, high: 105, low: 98, close: 102, volume: 10 },
      { openTime: 21_000, open: 102, high: 110, low: 101, close: 109, volume: 10 },
      { openTime: 22_000, open: 109, high: 106, low: 95, close: 96, volume: 10 },
      { openTime: 23_000, open: 96, high: 108, low: 96, close: 107, volume: 10 },
      { openTime: 24_000, open: 107, high: 115, low: 106, close: 114, volume: 10 },
    ];
    const fresh = scanMiEventsOnClose('BTCUSDT', '15m', [...pad(15), ...chochTail], new Set());
    expect(fresh.some((e) => e.eventType === 'choch')).toBe(true);
  });

  it('skips events already seen by id', () => {
    const candles = [...pad(16), ...sweepTail()];
    const first = scanMiEventsOnClose('BTCUSDT', '15m', candles, new Set());
    const id = first[0]?.eventId;
    expect(id).toBeDefined();
    const second = scanMiEventsOnClose('BTCUSDT', '15m', candles, new Set([id!]));
    expect(second).toHaveLength(0);
  });
});
