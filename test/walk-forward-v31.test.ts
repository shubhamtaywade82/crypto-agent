import { describe, it, expect } from 'vitest';
import { runWalkForward, type WalkForwardOptions } from '../src/learning/walk-forward.js';
import { loadRiskLimits } from '../src/domain/risk/risk-config.js';
import {
  sizeReplayPosition, defaultReplayConfig, futuresAccounting,
  type FuturesReplayConfig,
} from '../src/learning/futures-replay.js';
import type { Candle, Timeframe } from '../src/domain/market/types.js';
import { TIMEFRAMES } from '../src/domain/market/types.js';

const TF_MINUTES: Record<Timeframe, number> = { '5m': 5, '15m': 15, '1h': 60, '4h': 240 };

/** Same synthetic ladder generator as the deterministic baseline tests. */
const synthLadders = (baseBars: number, startPrice = 100, drift = 0.02): Record<Timeframe, Candle[]> => {
  const base: Candle[] = [];
  let price = startPrice;
  const open0 = 1_700_000_000_000;
  for (let i = 0; i < baseBars; i++) {
    const wave = Math.sin((i / 14) * Math.PI * 2);
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

const harness = (over?: Partial<WalkForwardOptions>) => {
  const candles = synthLadders(9600);
  return {
    candles,
    run: (o?: Partial<WalkForwardOptions>): ReturnType<typeof runWalkForward> =>
      runWalkForward({
        symbol: 'TESTUSDT', candles, btcCandles: candles,
        limits: loadRiskLimits(), stepBars: 6, maxHoldBars: 48,
        ...over, ...o,
      }),
  };
};

describe('Walk-forward — TRUE futures replay (V3.1 P0-3)', () => {
  it('produces trades with real position accounting (qty, notional, fees, funding)', () => {
    // Tight-stop synthetic geometry needs a matching risk budget; the
    // default budget would exceed the margin cap (live-parity rejection).
    const result = harness().run({ replay: { riskPerTradePct: 0.001, leverage: 5 } });
    expect(result.trades.length).toBeGreaterThan(0);
    for (const t of result.trades) {
      expect(t.quantity).toBeGreaterThan(0);
      expect(t.notional).toBeGreaterThan(0);
      expect(t.leverage).toBeLessThanOrEqual(5);
      expect(t.riskAmount).toBeCloseTo(10, 6);
      expect(t.feesPaid).toBeGreaterThan(0);
      expect(t.sample === 'IS' || t.sample === 'OOS').toBe(true);
    }
  }, 30_000);

  it('skips unsizable geometry like the live sizer would (counted, not silent)', () => {
    const result = harness().run();
    expect(result.trades).toHaveLength(0);
    expect(result.skippedUnsizable).toBeGreaterThan(0);
  });

  it('respects contract constraints: lot rounding, minima, leverage cap', () => {
    const limits = loadRiskLimits();
    const cfg = defaultReplayConfig('TESTUSDT', limits);
    // Huge stop distance on a high price -> quantity below exchange minimum.
    const rejected = sizeReplayPosition(cfg, 10_000, 100);
    expect(rejected.ok).toBe(false);
    expect(rejected.reason).toMatch(/below min/);
    // Normal geometry sizes within the lot step.
    const ok = sizeReplayPosition(cfg, 100, 99);
    expect(ok.ok).toBe(true);
    expect((ok.quantity / cfg.spec.lotSize) % 1).toBeCloseTo(0, 6);
  });

  it('funding accrues over whole periods and is signed by direction', () => {
    const limits = loadRiskLimits();
    const cfg: FuturesReplayConfig = {
      ...defaultReplayConfig('TESTUSDT', limits),
      fundingRate8h: 0.0001, slippageBps: 0, takerFeeRate: 0,
    };
    const trade = { direction: 'LONG' as const, entry: 100, stopLoss: 99 };
    // 47 bars = 235 minutes -> 0 whole 8h periods: no funding.
    const none = futuresAccounting(trade, { exit: 100.5, holdingBars: 47 }, cfg);
    expect(none.fundingPaid).toBeCloseTo(0, 10);
    // 480 bars = 2400 minutes = exactly 5 funding periods.
    const held = futuresAccounting(trade, { exit: 100.5, holdingBars: 480 }, cfg);
    expect(held.fundingPaid).toBeCloseTo(held.notional * 0.0001 * 5, 6);
    // Shorts RECEIVE positive funding (signed model).
    const short = futuresAccounting(
      { direction: 'SHORT' as const, entry: 100, stopLoss: 101 },
      { exit: 99.5, holdingBars: 480 }, cfg
    );
    expect(short.fundingPaid).toBeCloseTo(-short.notional * 0.0001 * 5, 6);
  });
});

describe('Walk-forward — OOS evaluation (V3.1 P0-4)', () => {
  it('splits the ladder chronologically at the configured fraction', () => {
    const h = harness();
    const result = h.run({ oosFraction: 0.3 });
    const base5 = h.candles['5m'];
    const boundaryIndex = Math.floor(base5.length * 0.7);
    expect(result.oos.boundaryOpenTime).toBe(base5[boundaryIndex].openTime);
    const isCount = result.trades.filter((t) => t.sample === 'IS').length;
    const oosCount = result.trades.filter((t) => t.sample === 'OOS').length;
    expect(result.oos.isTrades).toBe(isCount);
    expect(result.oos.oosTrades).toBe(oosCount);
    expect(isCount + oosCount).toBe(result.trades.length);
  });

  it('cell promotion requires BOTH in-sample and out-of-sample to pass', () => {
    const result = harness().run({ replay: { riskPerTradePct: 0.001, leverage: 5 } });
    for (const v of result.oos.cellVerdicts) {
      const isPass = v.inSample.verdict.promoted;
      const oosPass = v.outOfSample.verdict.promoted;
      expect(v.promoted).toBe(isPass && oosPass);
      if (!v.promoted) expect(v.reasons.length).toBeGreaterThan(0);
      // Reasons are tagged by sample.
      for (const r of v.reasons) expect(/^IS: |^OOS: /.test(r)).toBe(true);
    }
  });

  it('remains fully deterministic with the futures model (same input, identical output)', () => {
    const h = harness({ replay: { riskPerTradePct: 0.001, leverage: 5 } });
    const a = h.run();
    const b = h.run();
    expect(a.trades).toEqual(b.trades);
    expect(a.oos).toEqual(b.oos);
  });
});
