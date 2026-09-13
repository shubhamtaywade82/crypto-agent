import { describe, expect, it } from 'vitest';
import { loadRiskLimits } from '../src/domain/risk/risk-config.js';
import type { Candle, Timeframe } from '../src/domain/market/types.js';
import { buildMtfState } from '../src/engines/mtf-engine.js';
import { detectSetups } from '../src/engines/setup-engine.js';
import { evaluateFunnelBar } from '../src/learning/funnel-gates.js';
import { aggregateFunnel, sequentialDeadGate } from '../src/learning/funnel-aggregate.js';
import { runSetupFunnel } from '../src/learning/funnel-replay.js';
import { FUNNEL_CONFIDENCE_THRESHOLD } from '../src/learning/funnel-types.js';

const TF_MINUTES: Record<Timeframe, number> = { '5m': 5, '15m': 15, '1h': 60, '4h': 240 };

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

describe('setup funnel (9.2B)', () => {
  it('freezes the production confidence threshold at 0.75', () => {
    expect(FUNNEL_CONFIDENCE_THRESHOLD).toBe(0.75);
  });

  it('marks executable only when detectSetups would emit a valid candidate', () => {
    const candles = synthLadders(400);
    const mtf = buildMtfState({
      symbol: 'TESTUSDT',
      candles,
      btcCandles: candles,
      price: { last: candles['5m'][399]!.close, mark: candles['5m'][399]!.close, index: candles['5m'][399]!.close },
      futures: { fundingRate: 0, openInterest: 0, openInterestChange: 0 },
    });
    const limits = loadRiskLimits();
    const obs = evaluateFunnelBar(mtf, limits);
    const live = detectSetups(mtf, limits);
    expect(obs.final.executable).toBe(live.some((c) => c.valid));
  });

  it('does not require FVG/OB for executable (detector is absent in production)', () => {
    const candles = synthLadders(400);
    const mtf = buildMtfState({
      symbol: 'TESTUSDT', candles, btcCandles: candles,
      price: { last: candles['5m'][399]!.close, mark: candles['5m'][399]!.close, index: candles['5m'][399]!.close },
      futures: { fundingRate: 0, openInterest: 0, openInterestChange: 0 },
    });
    const obs = evaluateFunnelBar(mtf, loadRiskLimits());
    expect(obs.zone.reason).toBe('FVG_OB_DETECTOR_ABSENT');
    expect(obs.zone.observed).toBe(false);
  });

  it('replays every 5m bar and reports sequential pass rates', () => {
    const candles = synthLadders(12_000);
    const report = runSetupFunnel({
      symbol: 'TESTUSDT',
      candles,
      btcCandles: candles,
      limits: loadRiskLimits(),
      stepBars: 6,
      minBaseBars: 260,
    });
    expect(report.observations).toBeGreaterThan(100);
    expect(report.gates[0]?.id).toBe('observations');
    expect(report.gates[0]?.seen).toBe(report.observations);
    const live = report.gates.find((g) => g.id === 'executable');
    expect(live?.passed).toBeGreaterThanOrEqual(0);
    expect(report.deadGate === undefined || report.gates.some((g) => g.id === report.deadGate)).toBe(true);
  }, 30_000);

  it('is deterministic', () => {
    const candles = synthLadders(1200);
    const opts = {
      symbol: 'TESTUSDT' as const,
      candles, btcCandles: candles, limits: loadRiskLimits(),
      stepBars: 12, minBaseBars: 260,
    };
    const a = runSetupFunnel(opts);
    const b = runSetupFunnel(opts);
    expect(a).toEqual(b);
  }, 20_000);

  it('aggregates rejection reasons from failed gates', () => {
    const row = {
      timestamp: 1, symbol: 'SOLUSDT', direction: 'LONG' as const,
      macro: { observed: true, passed: false, reason: '4H_RANGE' },
      bias: { observed: true, passed: false, reason: '1H_UNALIGNED' },
      structure: { observed: true, passed: false, reason: '15M_UNALIGNED' },
      liquidity: { observed: true, passed: false, reason: 'NO_SWEEP' },
      zone: { observed: false, passed: false, reason: 'FVG_OB_DETECTOR_ABSENT' },
      retest: { observed: true, passed: false, reason: 'NO_RETEST' },
      trigger: { observed: true, passed: false, reason: 'NO_5M_TRIGGER' },
      confluence: { threshold: 0.75, passed: false },
      rr: { threshold: 2.5, passed: false },
      risk: { observed: true, passed: true },
      final: { executable: false, rejectionReason: '4H_RANGE' },
    };
    const summary = aggregateFunnel(Array.from({ length: 25 }, () => row));
    expect(sequentialDeadGate(summary.gates)).toBe('macro');
    expect(summary.rejectionReasons['4H_RANGE']).toBe(25);
  });
});
