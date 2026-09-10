import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { MarketStateStore } from '../src/engines/market-state-store.js';
import type { Candle } from '../src/domain/market/types.js';

const TFS = ['5m', '15m', '1h', '4h'] as const;
type Tf = (typeof TFS)[number];

const candleArb = fc.record({
  openTime: fc.integer({ min: 0, max: 1_000_000 }),
  open: fc.double({ min: 1, max: 100_000, noNaN: true }),
  high: fc.double({ min: 1, max: 100_000, noNaN: true }),
  low: fc.double({ min: 1, max: 100_000, noNaN: true }),
  close: fc.double({ min: 1, max: 100_000, noNaN: true }),
  volume: fc.double({ min: 0, max: 1_000, noNaN: true }),
});

const mk = (store: MarketStateStore, openTime: number, close: number): Candle =>
  ({ openTime, open: close, high: close, low: close, close, volume: 1 });

describe('MarketStateStore — kline upsert semantics', () => {
  it('replaces in-progress candles keyed by openTime (no duplicates)', () => {
    const store = new MarketStateStore();
    store.upsertKline({ symbol: 'BTCUSDT', timeframe: '5m', candle: mk(store, 1000, 100), at: 1 });
    store.upsertKline({ symbol: 'BTCUSDT', timeframe: '5m', candle: mk(store, 1000, 102), at: 2 });
    store.upsertKline({ symbol: 'BTCUSDT', timeframe: '5m', candle: mk(store, 1000, 103), at: 3 });
    const snap = store.snapshot('BTCUSDT')!;
    expect(snap.candles['5m']).toHaveLength(1);
    expect(snap.candles['5m'][0].close).toBe(103);
  });

  it('keeps ladders sorted by openTime and capped at 300', () => {
    const store = new MarketStateStore();
    for (let i = 0; i < 320; i++) {
      store.upsertKline({ symbol: 'BTCUSDT', timeframe: '1h', candle: mk(store, i * 1000, i), at: i });
    }
    const snap = store.snapshot('BTCUSDT')!;
    expect(snap.candles['1h']).toHaveLength(300);
    const times = snap.candles['1h'].map((c) => c.openTime);
    expect([...times].sort((a, b) => a - b)).toEqual(times);
    expect(times[0]).toBe(20 * 1000); // oldest trimmed
  });

  it('isolates timeframes and symbols', () => {
    const store = new MarketStateStore();
    store.upsertKline({ symbol: 'BTCUSDT', timeframe: '5m', candle: mk(store, 1, 50), at: 1 });
    store.upsertKline({ symbol: 'BTCUSDT', timeframe: '15m', candle: mk(store, 1, 51), at: 1 });
    store.upsertKline({ symbol: 'SOLUSDT', timeframe: '5m', candle: mk(store, 1, 52), at: 1 });
    const snap = store.snapshot('BTCUSDT')!;
    expect(snap.candles['5m'][0].close).toBe(50);
    expect(snap.candles['15m'][0].close).toBe(51);
    expect(snap.candles['1h']).toHaveLength(0);
    expect(store.snapshot('SOLUSDT')!.candles['5m'][0].close).toBe(52);
  });
});

describe('MarketStateStore — prices, futures context, freshness', () => {
  it('merges ticker/mark/index/funding/OI into one snapshot', () => {
    const store = new MarketStateStore();
    store.setTicker({ symbol: 'BTCUSDT', price: 105, at: 10 });
    store.setMarkIndex({ symbol: 'BTCUSDT', mark: 104.5, index: 104.1, fundingRate: 0.0001, at: 11 });
    store.setOpenInterest({ symbol: 'BTCUSDT', openInterest: 80_000, changePct: 1.5, at: 12 });
    const snap = store.snapshot('BTCUSDT')!;
    expect(snap.last).toBe(105);
    expect(snap.mark).toBe(104.5);
    expect(snap.index).toBe(104.1);
    expect(snap.fundingRate).toBe(0.0001);
    expect(snap.openInterest).toBe(80_000);
    expect(snap.openInterestChange).toBe(1.5);
  });

  it('staleness: never-seen undefined, then grows with clock', () => {
    const store = new MarketStateStore();
    expect(store.stalenessMs('BTCUSDT', 1000)).toBeUndefined();
    store.setTicker({ symbol: 'BTCUSDT', price: 1, at: 1000 });
    expect(store.stalenessMs('BTCUSDT', 1000)).toBe(0);
    expect(store.stalenessMs('BTCUSDT', 45_999)).toBe(44_999);
    expect(store.isFresh('BTCUSDT', 45_000, 45_999)).toBe(true);
    expect(store.isFresh('BTCUSDT', 45_000, 46_001)).toBe(false);
  });

  it('freshness tracks the LATEST event across components', () => {
    const store = new MarketStateStore();
    store.setTicker({ symbol: 'BTCUSDT', price: 1, at: 1000 });
    store.setMarkIndex({ symbol: 'BTCUSDT', mark: 1, index: 1, at: 5000 });
    expect(store.stalenessMs('BTCUSDT', 6000)).toBe(1000);
  });
});

describe('MarketStateStore — microstructure', () => {
  it('stores depth, trades and computes microstructure on snapshot', () => {
    const store = new MarketStateStore();
    store.setTicker({ symbol: 'BTCUSDT', price: 100, at: 1 });
    store.setDepth({
      symbol: 'BTCUSDT',
      bids: [{ price: 99.9, qty: 10 }],
      asks: [{ price: 100.1, qty: 4 }],
      at: 2,
    });
    store.pushTrade('BTCUSDT', { price: 100, qty: 1, at: 3, buyerIsMaker: false });
    store.pushTrade('BTCUSDT', { price: 100, qty: 2, at: 4, buyerIsMaker: true });
    const snap = store.snapshot('BTCUSDT')!;
    expect(snap.bids).toHaveLength(1);
    expect(snap.trades).toHaveLength(2);
    expect(snap.microstructure?.imbalance).toBeGreaterThan(0);
  });
});

describe('MarketStateStore — property invariants', () => {
  it('arbitrary update sequences keep candles sorted and unique per timeframe', () => {
    const arb = fc
      .tuple(candleArb, fc.constantFrom(...TFS), fc.integer({ min: 1, max: 1000 }))
      .map(([candle, tf, seq]) => ({ candle, tf, seq }));
    fc.assert(
      fc.property(fc.array(arb, { maxLength: 200 }), (updates) => {
        const store = new MarketStateStore();
        for (const u of updates) {
          store.upsertKline({ symbol: 'TESTUSDT', timeframe: u.tf, candle: u.candle, at: u.seq });
        }
        for (const tf of TFS) {
          const list = store.snapshot('TESTUSDT')?.candles[tf] ?? [];
          const times = list.map((c) => c.openTime);
          expect(new Set(times).size).toBe(times.length);
          expect([...times].sort((a, b) => a - b)).toEqual(times);
        }
      })
    );
  });
});
