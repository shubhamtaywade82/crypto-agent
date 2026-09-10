import { describe, it, expect } from 'vitest';
import { MarketStateStore } from '../src/engines/market-state-store.js';
import { PortfolioStateStore } from '../src/engines/portfolio-state-store.js';
import { buildMtfFromStore } from '../src/engines/market-state-engine.js';
import { PortfolioEngine } from '../src/engines/portfolio-engine.js';
import { runTradingPipeline } from '../src/engines/pipeline.js';
import { loadRiskLimits, type RiskLimits } from '../src/domain/risk/risk-config.js';
import type { Candle, Timeframe } from '../src/domain/market/types.js';
import { TIMEFRAMES } from '../src/domain/market/types.js';
import type { BrokerPosition, BrokerBalance } from '../src/infrastructure/broker/broker.js';
import { EventStore } from '../src/infrastructure/events/event-store.js';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** Build a ladder long enough for the indicator sanity gate (>=200 bars). */
const ladder = (base: number, n = 210): Candle[] =>
  Array.from({ length: n }, (_, i) => ({
    openTime: i * 300_000, open: base, high: base + 1, low: base - 1, close: base, volume: 1,
  }));

const feedSymbol = (store: MarketStateStore, symbol: string, price: number, at: number): void => {
  for (const tf of TIMEFRAMES) {
    store.backfillCandles(symbol, tf, ladder(price), at);
  }
  store.setTicker({ symbol, price, at });
  store.setMarkIndex({ symbol, mark: price, index: price, fundingRate: 0.0001, at });
};

describe('buildMtfFromStore — zero-REST MTF assembly', () => {
  it('serves a full MTF result from a fresh, complete store', () => {
    const store = new MarketStateStore();
    feedSymbol(store, 'BTCUSDT', 65_000, 100);
    feedSymbol(store, 'SOLUSDT', 150, 100);
    const mtf = buildMtfFromStore(store, 'SOLUSDT');
    expect(mtf).toBeDefined();
    expect(mtf!.state.symbol).toBe('SOLUSDT');
    expect(mtf!.state.price.last).toBe(150);
    expect(mtf!.state.futures.fundingRate).toBeCloseTo(0.0001);
    expect(mtf!.state.btcRegime).toBeDefined();
  });

  it('refuses (undefined) when the BTC macro ladder is missing', () => {
    const store = new MarketStateStore();
    feedSymbol(store, 'SOLUSDT', 150, 100);
    expect(buildMtfFromStore(store, 'SOLUSDT')).toBeUndefined();
  });

  it('refuses when any timeframe lacks indicator history', () => {
    const store = new MarketStateStore();
    feedSymbol(store, 'BTCUSDT', 65_000, 100);
    // SOL: full history everywhere except 1h, which only has 50 bars.
    for (const tf of TIMEFRAMES) {
      store.backfillCandles('SOLUSDT', tf, tf === '1h' ? ladder(150, 50) : ladder(150), 100);
    }
    store.setTicker({ symbol: 'SOLUSDT', price: 150, at: 100 });
    store.setMarkIndex({ symbol: 'SOLUSDT', mark: 150, index: 150, at: 100 });
    expect(buildMtfFromStore(store, 'SOLUSDT')).toBeUndefined();
  });
});

describe('PortfolioEngine — event-driven cache path', () => {
  const limits = { maxRiskPerTradePercent: 1, maxDailyLossPercent: 5 } as unknown as RiskLimits;

  const makeBroker = (
    positions: BrokerPosition[],
    balances: BrokerBalance[],
    counter: { rest: number }
  ): never =>
  ({
    id: 'counting',
    capabilities: ['ORDER_EXECUTION', 'ACCOUNT_READ'],
    getPositions: async (): Promise<BrokerPosition[]> => {
      counter.rest++;
      return positions;
    },
    getBalances: async (): Promise<BrokerBalance[]> => {
      counter.rest++;
      return balances;
    },
  }) as never;

  it('serves refresh() from the fresh cache with ZERO broker REST calls', async () => {
    const cache = new PortfolioStateStore();
    const counter = { rest: 0 };
    const broker = makeBroker([], [{ currency: 'USDT', total: 5_000, available: 5_000 }], counter);
    const engine = new PortfolioEngine({ broker, limits, cache, cacheMaxAgeMs: 10_000 });
    cache.syncSnapshot([], [{ currency: 'USDT', total: 7_777 }], Date.now());
    const state = await engine.refresh();
    expect(counter.rest).toBe(0);
    expect(state.equity).toBeCloseTo(7_777);
  });

  it('falls back to REST when the cache is stale and re-seeds it', async () => {
    const cache = new PortfolioStateStore();
    const counter = { rest: 0 };
    const positions: BrokerPosition[] = [
      { positionId: 'p1', pair: 'B-BTC_USDT', side: 'long', size: 0.1, entryPrice: 60_000, unrealizedPnl: 100 },
    ];
    const broker = makeBroker(positions, [{ currency: 'USDT', total: 5_000, available: 5_000 }], counter);
    const engine = new PortfolioEngine({ broker, limits, cache, cacheMaxAgeMs: 1_000 });
    // Seed old event: stale beyond cacheMaxAgeMs.
    cache.syncSnapshot([], [{ currency: 'USDT', total: 1 }], Date.now() - 5_000);
    const state = await engine.refresh();
    expect(counter.rest).toBe(2); // positions + balances
    expect(state.equity).toBeCloseTo(5_100);
    expect(state.openPositions).toBe(1);
    // Cache is now re-seeded with the REST truth and is fresh again.
    expect(cache.isFresh(1_000)).toBe(true);
    const second = await engine.refresh();
    expect(counter.rest).toBe(2); // no further REST while fresh
    expect(second.equity).toBeCloseTo(5_100);
  });

  it('REST path without a cache keeps the previous behavior', async () => {
    const counter = { rest: 0 };
    const broker = makeBroker([], [{ currency: 'USDT', total: 2_500, available: 2_500 }], counter);
    const engine = new PortfolioEngine({ broker, limits });
    const state = await engine.refresh();
    expect(counter.rest).toBe(2);
    expect(state.equity).toBeCloseTo(2_500);
  });
});

describe('runTradingPipeline — stream vs REST provenance', () => {
  const flatLadder = (base: number): Candle[] =>
    Array.from({ length: 210 }, (_, i) => ({
      openTime: i * 300_000, open: base, high: base + 0.5, low: base - 0.5, close: base, volume: 1,
    }));

  const makeDeps = (
    store: MarketStateStore | undefined,
    counter: { rest: number },
    storeFresh: boolean
  ): never => {
    const provider = {
      id: 'counting',
      capabilities: ['MARKET_DATA'],
      getKlines: async (symbol: string, tf: string): Promise<Candle[]> => {
        counter.rest++;
        return flatLadder(65_000);
      },
      getTickerPrice: async (): Promise<number> => {
        counter.rest++;
        return 65_000;
      },
      getMarkIndex: async (): Promise<{ mark: number; index: number }> => {
        counter.rest++;
        return { mark: 65_000, index: 65_000 };
      },
      getFundingRate: async (): Promise<number> => {
        counter.rest++;
        return 0.0001;
      },
      getOpenInterest: async (): Promise<{ oi: number; changePct: number }> => {
        counter.rest++;
        return { oi: 1000, changePct: 0 };
      },
      getOrderBookDepth: async (): Promise<{ bids: { price: number; qty: number }[]; asks: { price: number; qty: number }[] }> => {
        counter.rest++;
        return { bids: [{ price: 64_999, qty: 1 }], asks: [{ price: 65_001, qty: 1 }] };
      },
      getAggTrades: async (): Promise<[]> => [],
    };
    return {
      provider,
      limits: loadRiskLimits(),
      portfolio: { refresh: async (): Promise<never> => ({}) } as never,
      execution: {} as never,
      store: new EventStore({ filePath: join(mkdtempSync(join(tmpdir(), 'pipe-')), 'events.jsonl') }),
      marketStore: store,
      marketMaxStaleMs: 45_000,
      analyze: async (): Promise<unknown> => ({
        symbol: 'SOLUSDT', bias: 'NEUTRAL', summary: 'flat synthetic ladder for tests',
        keyLevels: { support: 1, resistance: 2 }, catalysts: [], risks: [],
      }),
      strategize: async (): Promise<unknown> => ({
        action: 'WAIT', confidence: 0.5, thesis: 'synthetic wait outcome',
        invalidation: 'n/a', setupType: 'TEST',
      }),
    } as never;
  };

  it('fresh store -> zero REST calls and provenance=stream', async () => {
    const store = new MarketStateStore();
    const at = Date.now();
    for (const tf of TIMEFRAMES) {
      store.backfillCandles('SOLUSDT', tf, flatLadder(150), at);
      store.backfillCandles('BTCUSDT', tf, flatLadder(65_000), at);
    }
    store.setTicker({ symbol: 'SOLUSDT', price: 150, at });
    store.setMarkIndex({ symbol: 'SOLUSDT', mark: 150, index: 150, fundingRate: 0.0001, at });
    store.setTicker({ symbol: 'BTCUSDT', price: 65_000, at });
    store.setMarkIndex({ symbol: 'BTCUSDT', mark: 65_000, index: 65_000, fundingRate: 0.0001, at });
    const counter = { rest: 0 };
    const deps = makeDeps(store, counter, true) as Parameters<typeof runTradingPipeline>[0];
    const trace = await runTradingPipeline(deps, 'SOLUSDT');
    expect(counter.rest).toBe(0);
    expect(['NO_SETUPS', 'WAIT', 'EXIT_SIGNALLED']).toContain(trace.status);
    const snap = deps.store.readAll(20).find((e) => e.type === 'pipeline.snapshot');
    expect((snap?.payload as { provenance: string }).provenance).toBe('stream');
  });

  it('stale store -> REST recovery path with provenance=rest', async () => {
    const store = new MarketStateStore();
    const counter = { rest: 0 };
    const deps = makeDeps(store, counter, false) as Parameters<typeof runTradingPipeline>[0];
    const trace = await runTradingPipeline(deps, 'SOLUSDT');
    expect(counter.rest).toBeGreaterThan(0);
    expect(['NO_SETUPS', 'WAIT', 'EXIT_SIGNALLED']).toContain(trace.status);
    const snap = deps.store.readAll(20).find((e) => e.type === 'pipeline.snapshot');
    expect((snap?.payload as { provenance: string }).provenance).toBe('rest');
  });
});
