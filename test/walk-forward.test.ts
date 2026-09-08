import { describe, it, expect } from 'vitest';
import { runWalkForward } from '../src/learning/walk-forward.js';
import { loadRiskLimits } from '../src/domain/risk/risk-config.js';
import type { Candle, Timeframe } from '../src/domain/market/types.js';
import { TIMEFRAMES } from '../src/domain/market/types.js';

const TF_MINUTES: Record<Timeframe, number> = { '5m': 5, '15m': 15, '1h': 60, '4h': 240 };

/**
 * Synthetic ladders: an oscillating uptrend (staircase with pullbacks)
 * sampled at every timeframe, all time-aligned on epoch multiples so the
 * harness's time-slicing sees consistent multi-TF history.
 */
const synthLadders = (baseBars: number, startPrice = 100, drift = 0.02): Record<Timeframe, Candle[]> => {
  // Base 5m series: sawtooth up — rise, dip, rise (trend + pullbacks).
  const base: Candle[] = [];
  let price = startPrice;
  const open0 = 1_700_000_000_000; // epoch-aligned anchor
  for (let i = 0; i < baseBars; i++) {
    const wave = Math.sin((i / 14) * Math.PI * 2); // periodic pullback
    const next = price + drift + wave * drift * 8;
    const open = price;
    const close = next;
    base.push({
      openTime: open0 + i * 5 * 60_000,
      open, close,
      high: Math.max(open, close) + drift * 0.5,
      low: Math.min(open, close) - drift * 0.5 - (wave < -0.6 ? drift * 2 : 0),
      volume: 1,
    });
    price = next;
  }
  const ladders: Record<Timeframe, Candle[]> = { '5m': base, '15m': [], '1h': [], '4h': [] };
  for (const tf of ['15m', '1h', '4h'] as const) {
    const step = TF_MINUTES[tf] / 5;
    const agg: Candle[] = [];
    for (let i = 0; i + step <= base.length; i += step) {
      const chunk = base.slice(i, i + step);
      agg.push({
        openTime: chunk[0].openTime,
        open: chunk[0].open,
        close: chunk[chunk.length - 1].close,
        high: Math.max(...chunk.map((c) => c.high)),
        low: Math.min(...chunk.map((c) => c.low)),
        volume: 1,
      });
    }
    ladders[tf] = agg;
  }
  return ladders;
};

const harness = (over?: Partial<Parameters<typeof runWalkForward>[0]>) => {
  // 9600 5m bars -> 200 4h bars, satisfying the warmup/indicator-history gate.
  const candles = synthLadders(9600);
  return {
    candles,
    run: (o?: Partial<Parameters<typeof runWalkForward>[0]>): ReturnType<typeof runWalkForward> =>
      runWalkForward({
        symbol: 'TESTUSDT',
        candles,
        btcCandles: candles,
        limits: loadRiskLimits(),
        stepBars: 6,
        maxHoldBars: 48,
        costR: 0.05,
        ...over,
      }),
  };
};

describe('walk-forward — deterministic replay', () => {
  it('produces trades from an oscillating uptrend', () => {
    const h = harness();
    const result = h.run();
    expect(result.trades.length).toBeGreaterThan(0);
    expect(result.trades.some((t) => t.setupType === 'PULLBACK_RECLAIM')).toBe(true);
  }, 30_000);

  it('is fully deterministic: same input, identical output', () => {
    const h = harness();
    const a = h.run();
    const b = h.run();
    expect(a.trades).toEqual(b.trades);
    expect(a.totalR).toBe(b.totalR);
  });

  it('keeps one simulated position at a time (no overlapping holds)', () => {
    const h = harness();
    const result = h.run({ stepBars: 2, maxHoldBars: 40 });
    for (let k = 1; k < result.trades.length; k++) {
      expect(result.trades[k].openedAt).toBeGreaterThanOrEqual(result.trades[k - 1].closedAt);
    }
  });

  it('bounded outcomes: cost-adjusted R cannot exceed the planned geometry', () => {
    const h = harness();
    const result = h.run();
    for (const t of result.trades) {
      const risk = Math.abs(t.entry - t.stopLoss);
      expect(risk).toBeGreaterThan(0);
      if (t.outcome === 'TARGET') {
        expect(t.rMultiple).toBeCloseTo(
          Math.abs(t.takeProfit - t.entry) / risk - 0.05, 6
        );
      }
      if (t.outcome === 'STOP') expect(t.rMultiple).toBeCloseTo(-1 - 0.05, 6);
      expect(t.maxAdverseR).toBeGreaterThanOrEqual(0);
      expect(t.maxFavorableR).toBeGreaterThanOrEqual(0);
    }
  });

  it('cells carry consistent statistics and gate verdicts with reasons', () => {
    const h = harness();
    const result = h.run();
    for (const cell of result.cells) {
      const own = result.trades.filter((t) => `${t.setupType}|${t.regime}` === cell.cell);
      expect(own.length).toBe(cell.n);
      expect(cell.expectancyR).toBeCloseTo(
        own.reduce((a, t) => a + t.rMultiple, 0) / own.length, 6
      );
    }
    for (const v of result.verdicts) {
      // Either it passes the frozen gate or says exactly why not.
      expect(v.promoted || v.reasons.length > 0).toBe(true);
    }
  });

  it('cold-start respect: no trades before the warmup window', () => {
    const h = harness();
    const result = h.run({ minBaseBars: 800 });
    const base5 = h.candles['5m'];
    const warmupOpenTime = base5[800].openTime;
    for (const t of result.trades) {
      expect(t.openedAt).toBeGreaterThanOrEqual(warmupOpenTime);
    }
  });
});
