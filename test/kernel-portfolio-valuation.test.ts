import { describe, it, expect, vi } from 'vitest';
import { FxRateCache, normalizeBalances } from '../src/domain/portfolio/valuation.js';
import { PortfolioEngine } from '../src/engines/portfolio-engine.js';
import { PerformanceEngine } from '../src/engines/performance-engine.js';
import { DEFAULT_RISK_LIMITS } from '../src/domain/risk/risk-config.js';
import type { IExecutionBroker } from '../src/infrastructure/broker/broker.js';

describe('FxRateCache — TTL + staleness policy (no forever-cache)', () => {
  it('quotes FRESH within the fresh window and refreshes afterwards', async () => {
    vi.useFakeTimers();
    try {
      const fetcher = vi.fn().mockResolvedValue(88);
      const cache = new FxRateCache({ freshMs: 1_000, staleMs: 2_000 });

      const q1 = await cache.quote(fetcher);
      expect(q1).toMatchObject({ rate: 88, freshness: 'REFRESHED' });
      expect(fetcher).toHaveBeenCalledTimes(1);

      vi.advanceTimersByTime(500);
      const q2 = await cache.quote(fetcher);
      expect(q2.freshness).toBe('FRESH');
      expect(fetcher).toHaveBeenCalledTimes(1); // cached

      vi.advanceTimersByTime(700); // past fresh, within stale
      const q3 = await cache.quote(fetcher);
      expect(q3.freshness).toBe('REFRESHED');
      expect(fetcher).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('serves STALE on refresh failure within the stale window, throws when expired', async () => {
    vi.useFakeTimers();
    try {
      const cache = new FxRateCache({ freshMs: 1_000, staleMs: 5_000 });
      const good = vi.fn().mockResolvedValue(88);
      await cache.quote(good);

      vi.advanceTimersByTime(2_000); // stale zone
      const failing = vi.fn().mockRejectedValue(new Error('network down'));
      const stale = await cache.quote(failing);
      expect(stale.freshness).toBe('STALE');
      expect(stale.rate).toBe(88);

      vi.advanceTimersByTime(6_000); // beyond stale window
      await expect(cache.quote(failing)).rejects.toThrow(/cache expired/);
    } finally {
      vi.useRealTimers();
    }
  });

  it('rejects non-positive garbage rates', async () => {
    const cache = new FxRateCache();
    await expect(cache.quote(async () => 0)).rejects.toThrow(/non-positive/);
  });
});

describe('normalizeBalances — canonical USDT equity (no dimensional mixing)', () => {
  it('never adds INR to USDT as if they were the same unit', () => {
    // 10,000 INR + 1,000 USDT at 88.0 -> ~1,113.64 USDT, NOT 11,000.
    const v = normalizeBalances(
      [{ currency: 'INR', total: 10_000 }, { currency: 'USDT', total: 1_000 }],
      88, 'FRESH'
    );
    expect(v.equity).toBeCloseTo(1_000 + 10_000 / 88, 6);
    expect(v.fxRate).toBe(88);
    expect(v.fxFreshness).toBe('FRESH');
    expect(v.excluded).toHaveLength(0);
  });

  it('excludes currencies that cannot be normalized', () => {
    const v = normalizeBalances(
      [{ currency: 'USDT', total: 500 }, { currency: 'DOGE', total: 999 }],
      1, 'NOT_REQUIRED'
    );
    expect(v.equity).toBe(500);
    expect(v.excluded).toEqual(['DOGE']);
  });
});

describe('PerformanceEngine — real portfolio metrics (no more zeros)', () => {
  it('tracks daily realized PnL, loss streak and drawdown from outcomes', () => {
    const perf = new PerformanceEngine();
    perf.recordEquity(10_000);
    perf.recordEquity(9_800); // -2% drawdown
    perf.recordEquity(10_200); // new HWM
    perf.recordEquity(10_100); // -0.98% from 10,200

    expect(perf.getDrawdownPercent()).toBeCloseTo((10200 - 10100) / 10200 * 100, 6);
    expect(perf.getDailyRealizedPnl()).toBe(0);

    perf.recordTradeClosed(-50);
    perf.recordTradeClosed(-30);
    perf.recordTradeClosed(80);
    expect(perf.getLossStreak()).toBe(0); // last trade was a win
    expect(perf.getDailyRealizedPnl()).toBe(0); // -50 - 30 + 80

    perf.recordTradeClosed(-20);
    perf.recordTradeClosed(-10);
    expect(perf.getLossStreak()).toBe(2);
    expect(perf.getDailyRealizedPnl()).toBeCloseTo(-30, 6);

    const stats = perf.stats();
    expect(stats.tradeCount).toBe(5);
    expect(stats.winCount).toBe(1);
    expect(stats.lossCount).toBe(4);
    expect(stats.maxDrawdownPercent).toBeCloseTo(2, 6);
  });

  it('hydrates from the event store so restarts keep the risk governor honest', () => {
    const events = [
      { at: Date.now(), type: 'trade.closed', payload: { pnl: -40 } },
      { at: Date.now(), type: 'trade.closed', payload: { pnl: -25 } },
      { at: Date.now(), type: 'portfolio.equity', payload: { equity: 12_000 } },
    ];
    const perf = new PerformanceEngine();
    perf.hydrate(events);
    expect(perf.getLossStreak()).toBe(2);
    expect(perf.getDailyRealizedPnl()).toBeCloseTo(-65, 6);
    perf.recordEquity(11_000);
    expect(perf.getDrawdownPercent()).toBeCloseTo(1000 / 12000 * 100, 6);
  });
});

describe('PortfolioEngine — FX normalization + wired metrics', () => {
  const makeBroker = (balances: { currency: string; total: number; available: number }[]): IExecutionBroker =>
    ({
      getPositions: async () => [],
      getBalances: async () => balances,
    }) as unknown as IExecutionBroker;

  it('normalizes an INR + USDT account into canonical USDT equity', async () => {
    const perf = new PerformanceEngine();
    const engine = new PortfolioEngine({
      broker: makeBroker([
        { currency: 'INR', total: 88_000, available: 88_000 },
        { currency: 'USDT', total: 1_000, available: 1_000 },
      ]),
      limits: DEFAULT_RISK_LIMITS,
      performance: perf,
      usdtInrRate: async () => 88,
    });
    const state = await engine.refresh();
    expect(state.equity).toBeCloseTo(2_000, 6); // (88,000 / 88) + 1,000
    expect(state.currencyBasis).toBe('USDT');
    expect(state.fxRate).toBe(88);
    expect(state.fxFreshness).toBe('REFRESHED');
  });

  it('excludes INR instead of mis-adding when no FX source is wired', async () => {
    const engine = new PortfolioEngine({
      broker: makeBroker([
        { currency: 'INR', total: 88_000, available: 88_000 },
        { currency: 'USDT', total: 1_000, available: 1_000 },
      ]),
      limits: DEFAULT_RISK_LIMITS,
    });
    const state = await engine.refresh();
    expect(state.equity).toBeCloseTo(1_000, 6);
    expect(state.valuationExcluded?.join(',')).toContain('INR');
  });

  it('surfaces real drawdown and loss streak through the metrics source', async () => {
    const perf = new PerformanceEngine();
    perf.recordTradeClosed(-100);
    perf.recordTradeClosed(-50);

    const engine = new PortfolioEngine({
      broker: makeBroker([{ currency: 'USDT', total: 10_000, available: 10_000 }]),
      limits: DEFAULT_RISK_LIMITS,
      performance: perf,
    });
    const state = await engine.refresh();
    expect(state.lossStreak).toBe(2);
    expect(state.dailyRealizedPnl).toBeCloseTo(-150, 6);
    expect(state.dailyLossPercent).toBeCloseTo(1.5, 6);
    // Equity feed registered: HWM 10,000, no drawdown at peak.
    expect(state.drawdownPercent).toBe(0);
  });
});
