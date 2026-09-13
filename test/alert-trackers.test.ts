import { describe, expect, it } from 'vitest';
import { distancePct, inferBreakout, nextBand } from '../src/engines/alerts/level-tracker.js';
import { inferPhase } from '../src/engines/alerts/setup-tracker.js';
import type { SetupCandidate } from '../src/engines/setup-engine.js';

const candidate = (over: Partial<SetupCandidate> = {}): SetupCandidate => ({
  id: 's1',
  type: 'PULLBACK_RECLAIM',
  symbol: 'SOLUSDT',
  direction: 'LONG',
  entry: 101.8,
  stopLoss: 101.4,
  takeProfit: 103.3,
  orderType: 'LIMIT',
  leverage: 2,
  rr: 2.6,
  htfAlignment: 4,
  confidence: 0.8,
  thesis: 'reclaim',
  invalidation: '5m close below 101.40',
  warnings: [],
  valid: true,
  ...over,
});

describe('level hysteresis', () => {
  it('enters approaching at 0.15% and reaches at 0.02%', () => {
    expect(nextBand(0.20, 'FAR')).toBe('FAR');
    expect(nextBand(0.10, 'FAR')).toBe('APPROACHING');
    expect(nextBand(0.01, 'APPROACHING')).toBe('REACHED');
  });

  it('does not exit approaching until 0.40%', () => {
    expect(nextBand(0.20, 'APPROACHING')).toBe('APPROACHING');
    expect(nextBand(0.50, 'APPROACHING')).toBe('FAR');
  });

  it('classifies breakout watch vs close confirmation', async () => {
    expect(inferBreakout({
      price: 102.3, close: 102.1, level: 102.45, bos: true, prev: 'NONE',
    })).toBe('WATCH');
    expect(inferBreakout({
      price: 102.5, close: 102.53, level: 102.45, bos: true, prev: 'WATCH',
    })).toBe('CONFIRMED');
    expect(inferBreakout({
      price: 102.12, close: 102.12, level: 102.45, bos: false, prev: 'WATCH',
    })).toBe('FAILED');
  });
});

describe('setup phase inference', () => {
  it('treats a sweep as a trigger, not a signal, when confidence is low', () => {
    const phase = inferPhase({
      candidate: candidate({ confidence: 0.4 }),
      price: 101.8,
      close5m: 101.8,
      mi: [{ eventType: 'liquidity_sweep', eventId: 'e1', direction: 'bullish', label: 'sweep' }],
      prev: 'ZONE_REACHED',
    });
    expect(phase).toBe('TRIGGER_DETECTED');
  });

  it('confirms only with zone + trigger + confidence gate', () => {
    const phase = inferPhase({
      candidate: candidate({ confidence: 0.84 }),
      price: 101.8,
      close5m: 101.8,
      mi: [{ eventType: 'choch', eventId: 'c1', direction: 'bullish', label: 'choch' }],
      prev: 'ZONE_REACHED',
    });
    expect(phase).toBe('CONFIRMED');
  });

  it('invalidates when 5m closes through the stop', () => {
    expect(inferPhase({
      candidate: candidate(), price: 101.5, close5m: 101.3, mi: [], prev: 'CONFIRMED',
    })).toBe('INVALIDATED');
  });
});
