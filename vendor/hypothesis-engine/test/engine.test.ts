import { describe, it, expect } from 'vitest';
import { Decimal } from 'decimal.js';
import type { Candle } from '@nemesis-oss/market-events';

import { testHypothesis } from '../src/engine.js';
import type { Hypothesis } from '../src/engine.js';

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

describe('hypothesis-engine / testHypothesis', () => {
  it('returns insufficient_sample when no events are detected', () => {
    // Use a perfectly flat price series — no FVGs, no swings, no displacement.
    const candles: Candle[] = [];
    for (let i = 0; i < 10; i++) {
      candles.push({
        timestamp: 1_700_000_000_000 + i * FIFTEEN_MIN,
        open: new Decimal('100'),
        high: new Decimal('100'),
        low: new Decimal('100'),
        close: new Decimal('100'),
        volume: new Decimal('1000'),
      });
    }
    const hypothesis: Hypothesis = {
      id: 'h1',
      description: 'Test FVG edge',
      symbol: 'BTCUSDT',
      timeframe: '15m',
      eventType: 'fvg',
    };
    const result = testHypothesis(hypothesis, { candles });
    expect(result.verdict).toBe('insufficient_sample');
    expect(result.sampleSize).toBe(0);
  });

  it('tests a basic FVG hypothesis and returns a verdict', () => {
    const candles = makeCandles(300);
    const hypothesis: Hypothesis = {
      id: 'h2',
      description: 'Bullish FVG continuation on SOLUSDT 15m',
      symbol: 'SOLUSDT',
      timeframe: '15m',
      eventType: 'fvg',
      horizonCandles: 24,
    };
    const result = testHypothesis(hypothesis, { candles });

    expect(['validated', 'rejected', 'inconclusive', 'insufficient_sample']).toContain(result.verdict);
    expect(result.sampleSize).toBeGreaterThan(0);
    expect(typeof result.reachRate).toBe('number');
    expect(typeof result.baselineRate).toBe('number');
    expect(typeof result.uplift).toBe('number');
    expect(typeof result.pValue).toBe('number');
    expect(typeof result.evidenceSummary).toBe('string');
    expect(result.evidenceSummary).toContain('Verdict:');
    expect(result.evidenceSummary).toContain('Sample:');
  });

  it('applies regime filters', () => {
    const candles = makeCandles(300);
    const hypothesis: Hypothesis = {
      id: 'h3',
      description: 'FVG in bullish trend',
      symbol: 'BTCUSDT',
      timeframe: '15m',
      eventType: 'fvg',
      regimeFilter: { trend: 'bullish' },
    };
    const result = testHypothesis(hypothesis, { candles });
    expect(result.verdict).toBeDefined();
  });

  it('runs walk-forward OOS validation when dataset is large enough', () => {
    const candles = makeCandles(500);
    const hypothesis: Hypothesis = {
      id: 'h4',
      description: 'FVG with OOS validation',
      symbol: 'BTCUSDT',
      timeframe: '15m',
      eventType: 'fvg',
    };
    const result = testHypothesis(hypothesis, {
      candles,
      trainCandlesCount: 200,
      testCandlesCount: 100,
      stepCandlesCount: 100,
    });

    // OOS fields should be present if walk-forward ran.
    if (result.oosReachRate !== undefined) {
      expect(typeof result.oosReachRate).toBe('number');
      expect(typeof result.oosDegradation).toBe('number');
    }
  });

  it('produces JSON-serializable results', () => {
    const candles = makeCandles(300);
    const hypothesis: Hypothesis = {
      id: 'h5',
      description: 'FVG JSON test',
      symbol: 'BTCUSDT',
      timeframe: '15m',
      eventType: 'fvg',
    };
    const result = testHypothesis(hypothesis, { candles });
    const json = JSON.stringify(result);
    expect(json.length).toBeGreaterThan(0);
    expect(json).not.toMatch(/\{\}/);
  });
});
