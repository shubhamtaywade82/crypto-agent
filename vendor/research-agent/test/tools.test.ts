import { describe, it, expect } from 'vitest';
import { Decimal } from 'decimal.js';
import type { Candle } from '@nemesis-oss/market-events';

import { createResearchTools, invokeToolDirect } from '../src/tools.js';
import type { ResearchContext } from '../src/context.js';

/* ------------------------------------------------------------------ *
 * Synthetic dataset generator
 * ------------------------------------------------------------------ */

const ONE_MIN = 60_000;
const FIFTEEN_MIN = 15 * ONE_MIN;

/**
 * Generate a deterministic trending+rangey OHLCV series with enough
 * structure to trigger FVGs, swings, BOS, and the occasional sweep.
 *
 * The seed is fixed (no Math.random) so tests are reproducible.
 */
function makeCandles(count: number, startTs = 1_700_000_000_000): Candle[] {
  const candles: Candle[] = [];
  let price = 100;
  for (let i = 0; i < count; i++) {
    // Sin-driven drift produces both uptrends and downtrends.
    const drift = Math.sin(i / 13) * 0.8 + Math.sin(i / 47) * 0.4;
    const open = price;
    const close = price + drift + (i % 7 === 0 ? -2.5 : 0); // periodic displacement
    const high = Math.max(open, close) + Math.abs(Math.sin(i / 3)) * 1.2 + (i % 11 === 0 ? 0.8 : 0);
    const low = Math.min(open, close) - Math.abs(Math.cos(i / 3)) * 1.2 - (i % 17 === 0 ? 0.8 : 0);
    const volume = 1000 + Math.abs(Math.sin(i / 5)) * 500;
    candles.push({
      timestamp: startTs + i * FIFTEEN_MIN,
      open: new Decimal(open.toFixed(4)),
      high: new Decimal(high.toFixed(4)),
      low: new Decimal(low.toFixed(4)),
      close: new Decimal(close.toFixed(4)),
      volume: new Decimal(volume.toFixed(4)),
    });
    price = close;
  }
  return candles;
}

function makeContext(): ResearchContext {
  const candles = makeCandles(400);
  return {
    symbol: 'SOLUSDT',
    timeframe: '15m',
    candles,
  };
}

/* ------------------------------------------------------------------ *
 * Tests
 * ------------------------------------------------------------------ */

describe('research-agent tools', () => {
  it('lists all expected event detectors', async () => {
    const ctx = makeContext();
    const cat = createResearchTools(ctx);
    const res = await invokeToolDirect(cat, 'list_event_detectors', {});
    expect(res.success).toBe(true);
    expect(res.name).toBe('list_event_detectors');
    expect(res.trustLevel).toBe('verified');
    expect(Array.isArray(res.output)).toBe(true);
    expect(res.output).toEqual([
      'fvg', 'bos', 'choch', 'mss', 'order_block',
      'liquidity_sweep', 'displacement', 'vsa',
    ]);
  });

  it('returns a dataset summary that is JSON-serializable', async () => {
    const ctx = makeContext();
    const cat = createResearchTools(ctx);
    const res = await invokeToolDirect(cat, 'dataset_summary', {});
    expect(res.success).toBe(true);
    const json = JSON.stringify(res.output);
    expect(json.length).toBeGreaterThan(0);
    // No '{}' from unserialized Decimal fields.
    expect(json).not.toMatch(/\{\}/);
    const parsed = JSON.parse(json) as {
      symbol: string; timeframe: string; candleCount: number;
      detectorCounts: Record<string, number>;
    };
    expect(parsed.symbol).toBe('SOLUSDT');
    expect(parsed.timeframe).toBe('15m');
    expect(parsed.candleCount).toBe(400);
    for (const v of Object.values(parsed.detectorCounts)) {
      expect(typeof v).toBe('number');
      expect(v).toBeGreaterThanOrEqual(0);
    }
  });

  it('detects events for every event type without throwing', async () => {
    const ctx = makeContext();
    const cat = createResearchTools(ctx);
    const types = ['fvg', 'bos', 'choch', 'mss', 'order_block', 'liquidity_sweep', 'displacement'] as const;
    for (const eventType of types) {
      const res = await invokeToolDirect(cat, 'detect_events', { eventType });
      expect(res.success, `detect_events(${eventType}) should succeed`).toBe(true);
      expect(res.trustLevel).toBe('verified');
      const out = res.output as {
        symbol: string; eventType: string; count: number; events: unknown[];
      };
      expect(out.symbol).toBe('SOLUSDT');
      expect(out.eventType).toBe(eventType);
      expect(typeof out.count).toBe('number');
      expect(Array.isArray(out.events)).toBe(true);
      // Verify the payload is JSON-serializable without losing precision.
      const json = JSON.stringify(out);
      expect(json).not.toMatch(/\{\}/);
    }
  });

  it('returns a market context snapshot at a given candle index', async () => {
    const ctx = makeContext();
    const cat = createResearchTools(ctx);
    const res = await invokeToolDirect(cat, 'get_market_context', { candleIndex: 100 });
    expect(res.success).toBe(true);
    const out = res.output as {
      symbol: string; candleIndex: number; timestamp: number;
      context: { atr: string; trendRegime: string; volatilityRegime: string };
    };
    expect(out.candleIndex).toBe(100);
    expect(out.symbol).toBe('SOLUSDT');
    expect(typeof out.timestamp).toBe('number');
    // atr survives serialization as a full-precision string.
    expect(typeof out.context.atr).toBe('string');
    expect(['bullish', 'bearish', 'range']).toContain(out.context.trendRegime);
    expect(['low', 'normal', 'high']).toContain(out.context.volatilityRegime);
  });

  it('runs the universal study and reports multiple-testing', async () => {
    const ctx = makeContext();
    const cat = createResearchTools(ctx);
    const res = await invokeToolDirect(cat, 'run_study', {});
    expect(res.success).toBe(true);
    const out = res.output as {
      results: Array<{ eventType: string; sampleSize: number }>;
      multipleTesting?: { procedure: string; totalTests: number };
      matchRatios: Record<string, number>;
    };
    expect(Array.isArray(out.results)).toBe(true);
    expect(out.results.length).toBe(8);
    expect(out.multipleTesting?.procedure).toBe('benjamini_hochberg');
    expect(Object.keys(out.matchRatios).length).toBe(8);
    const json = JSON.stringify(out);
    expect(json).not.toMatch(/\{\}/);
  });

  it('runs a single-event study for fvg', async () => {
    const ctx = makeContext();
    const cat = createResearchTools(ctx);
    const res = await invokeToolDirect(cat, 'run_event_study', { eventType: 'fvg' });
    expect(res.success).toBe(true);
    const out = res.output as {
      result: { eventType: string; sampleSize: number } | null;
    };
    expect(out.result).not.toBeNull();
    expect(out.result?.eventType).toBe('fvg');
  });

  it('evaluates pairwise interaction between fvg and liquidity_sweep', async () => {
    const ctx = makeContext();
    const cat = createResearchTools(ctx);
    const res = await invokeToolDirect(cat, 'evaluate_interaction', {
      eventA: 'fvg',
      eventB: 'liquidity_sweep',
    });
    expect(res.success).toBe(true);
    const out = res.output as {
      pair: {
        primaryType: string;
        secondaryType: string;
        sampleSizePrimary: number;
        sampleSizeSecondary: number;
        interactionUplift: number;
        redundancyScore: number;
      };
      anchor: { anchorType: string; conditionalUplift: number };
    };
    expect(out.pair.primaryType).toBe('fvg');
    expect(out.pair.secondaryType).toBe('liquidity_sweep');
    expect(typeof out.pair.interactionUplift).toBe('number');
    expect(out.pair.redundancyScore).toBeGreaterThanOrEqual(0);
    expect(out.pair.redundancyScore).toBeLessThanOrEqual(1);
  });

  it('evaluates negative-evidence impact for fvg', async () => {
    const ctx = makeContext();
    const cat = createResearchTools(ctx);
    const res = await invokeToolDirect(cat, 'evaluate_negative_evidence', {
      eventType: 'fvg',
    });
    expect(res.success).toBe(true);
    const out = res.output as {
      impact: {
        sampleSize: number;
        alignedHitRateR2: number;
        conflictedHitRateR2: number;
        netEvidenceScore: number;
      };
    };
    expect(out.impact.sampleSize).toBeGreaterThanOrEqual(0);
    expect(out.impact.alignedHitRateR2).toBeGreaterThanOrEqual(0);
    expect(out.impact.alignedHitRateR2).toBeLessThanOrEqual(1);
    expect(out.impact.netEvidenceScore).toBeGreaterThanOrEqual(-1);
    expect(out.impact.netEvidenceScore).toBeLessThanOrEqual(1);
  });

  it('runs walk-forward validation when the dataset is large enough', async () => {
    // Need enough candles for at least one train+embargo+test window.
    const ctx: ResearchContext = {
      symbol: 'SOLUSDT',
      timeframe: '15m',
      candles: makeCandles(600),
    };
    const cat = createResearchTools(ctx);
    const res = await invokeToolDirect(cat, 'run_walk_forward', {
      trainCandlesCount: 200,
      testCandlesCount: 100,
      stepCandlesCount: 100,
    });
    expect(res.success).toBe(true);
    const out = res.output as {
      windowCount: number;
      stability: Array<{ component: string; isStable: boolean }>;
      stabilityMarkdown: string;
    };
    expect(out.windowCount).toBeGreaterThan(0);
    expect(out.stability.length).toBeGreaterThan(0);
    expect(out.stabilityMarkdown).toContain('Walk-Forward Stability');
  });

  it('returns a failed ToolResult for an unknown tool handle', async () => {
    const ctx = makeContext();
    const cat = createResearchTools(ctx);
    const res = await invokeToolDirect(cat, 'does_not_exist', {});
    expect(res.success).toBe(false);
    expect(res.trustLevel).toBe('unverified');
    expect(res.error).toMatch(/Unknown tool/);
  });

  it('returns a failed ToolResult for malformed args', async () => {
    const ctx = makeContext();
    const cat = createResearchTools(ctx);
    const res = await invokeToolDirect(cat, 'detect_events', {
      eventType: 'not_a_real_event_type',
    });
    expect(res.success).toBe(false);
    expect(res.trustLevel).toBe('unverified');
    expect(res.error).toMatch(/Invalid args/);
  });
});
