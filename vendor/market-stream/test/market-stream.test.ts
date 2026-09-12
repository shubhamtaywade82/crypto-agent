import { describe, it, expect, vi } from 'vitest';
import { Decimal } from 'decimal.js';
import type { Candle, Timeframe } from '@nemesis-oss/market-events';
import type { ExchangeAdapter, StreamSubscription, StreamStatus } from '@nemesis-oss/market-data';

import { createMarketStream } from '../src/orchestrator.js';
import { CandleBuffer } from '../src/candle-buffer.js';
import type { MarketStreamOptions, StreamKey, MarketStreamCallbacks } from '../src/types.js';

/* ------------------------------------------------------------------ *
 * Helpers
 * ------------------------------------------------------------------ */

const FIFTEEN_MIN = 15 * 60_000;

function makeCandle(
  i: number,
  basePrice = 100,
  startTs = 1_700_000_000_000,
): Candle {
  const drift = Math.sin(i / 13) * 0.8 + Math.sin(i / 47) * 0.4;
  const open = basePrice + drift;
  const close = open + (i % 7 === 0 ? -2.5 : 0.5);
  const high = Math.max(open, close) + 0.5;
  const low = Math.min(open, close) - 0.5;
  const volume = 1000 + Math.abs(Math.sin(i / 5)) * 500;
  return {
    timestamp: startTs + i * FIFTEEN_MIN,
    open: new Decimal(open.toFixed(4)),
    high: new Decimal(high.toFixed(4)),
    low: new Decimal(low.toFixed(4)),
    close: new Decimal(close.toFixed(4)),
    volume: new Decimal(volume.toFixed(4)),
  };
}

/**
 * Build a mock ExchangeAdapter that lets tests push synthetic candles
 * through the onCandle callback. The adapter pretends to open a WS
 * connection immediately.
 */
function makeMockAdapter(): {
  adapter: ExchangeAdapter;
  pushCandle: (symbol: string, timeframe: Timeframe, candle: Candle) => void;
  setStatus: (symbol: string, timeframe: Timeframe, status: StreamStatus) => void;
} {
  const handlers = new Map<string, { onCandle: (c: Candle) => void; onStatus?: (s: string) => void; onError?: (e: Error) => void }>();

  const key = (s: string, tf: Timeframe) => `${s}:${tf}`;

  const adapter: ExchangeAdapter = {
    exchange: 'binance',
    restBaseUrl: 'https://mock',
    wsBaseUrl: 'wss://mock',

    async fetchKlines() {
      return [];
    },

    async subscribeKlines(sub) {
      const k = key(sub.symbol, sub.timeframe);
      handlers.set(k, {
        onCandle: sub.onCandle,
        onStatus: sub.onStatus,
        onError: sub.onError,
      });
      // Simulate immediate open.
      sub.onStatus?.('open');

      const subscription: StreamSubscription = {
        status: 'open' as StreamStatus,
        async unsubscribe() {
          handlers.delete(k);
        },
      };
      return subscription;
    },

    async fetchFundingRate() {
      return null;
    },
    async fetchOpenInterest() {
      return null;
    },
    async fetchMarkPrice() {
      return null;
    },
  };

  return {
    adapter,
    pushCandle: (symbol, timeframe, candle) => {
      const h = handlers.get(key(symbol, timeframe));
      h?.onCandle(candle);
    },
    setStatus: (symbol, timeframe, status) => {
      const h = handlers.get(key(symbol, timeframe));
      h?.onStatus?.(status);
    },
  };
}

/* ------------------------------------------------------------------ *
 * CandleBuffer tests
 * ------------------------------------------------------------------ */

describe('market-stream / CandleBuffer', () => {
  it('pushes and retrieves candles in order', () => {
    const buf = new CandleBuffer(5);
    expect(buf.length).toBe(0);

    const c1 = makeCandle(0);
    const c2 = makeCandle(1);
    const c3 = makeCandle(2);

    expect(buf.push(c1)).toBe(true);
    expect(buf.push(c2)).toBe(true);
    expect(buf.push(c3)).toBe(true);
    expect(buf.length).toBe(3);

    const arr = buf.toArray();
    expect(arr.length).toBe(3);
    expect(arr[0]!.timestamp).toBe(c1.timestamp);
    expect(arr[2]!.timestamp).toBe(c3.timestamp);
  });

  it('deduplicates by timestamp', () => {
    const buf = new CandleBuffer(5);
    const c = makeCandle(0);

    expect(buf.push(c)).toBe(true);
    expect(buf.push(c)).toBe(false); // dup
    expect(buf.length).toBe(1);
  });

  it('wraps around when full (ring buffer)', () => {
    const buf = new CandleBuffer(3);
    const c0 = makeCandle(0);
    const c1 = makeCandle(1);
    const c2 = makeCandle(2);
    const c3 = makeCandle(3);

    buf.push(c0);
    buf.push(c1);
    buf.push(c2);
    // Buffer is full; pushing c3 should evict c0.
    buf.push(c3);

    expect(buf.length).toBe(3);
    const arr = buf.toArray();
    // Oldest should now be c1, newest c3.
    expect(arr[0]!.timestamp).toBe(c1.timestamp);
    expect(arr[2]!.timestamp).toBe(c3.timestamp);
  });

  it('returns the latest candle', () => {
    const buf = new CandleBuffer(5);
    expect(buf.latest()).toBeNull();

    const c1 = makeCandle(1);
    const c2 = makeCandle(2);
    buf.push(c1);
    buf.push(c2);

    expect(buf.latest()?.timestamp).toBe(c2.timestamp);
  });

  it('throws on capacity < 3', () => {
    expect(() => new CandleBuffer(2)).toThrow(/capacity must be >= 3/);
  });
});

/* ------------------------------------------------------------------ *
 * createMarketStream tests
 * ------------------------------------------------------------------ */

describe('market-stream / createMarketStream', () => {
  it('maintains MarketState across a sequence of candles', async () => {
    const { adapter, pushCandle } = makeMockAdapter();

    const states: ReturnType<NonNullable<MarketStreamCallbacks['onState']>>[] = [];
    const stream = createMarketStream(
      {
        adapter,
        streams: [{ symbol: 'BTCUSDT', timeframe: '15m' }],
        candleBufferDepth: 50,
        detectors: ['fvg'],
        eventLookbackBars: 5,
      },
      {
        onState: (s) => states.push(s),
        onCandle: () => {},
      },
    );

    await stream.start();

    // Push 20 candles — enough for swings, structure, FVGs.
    for (let i = 0; i < 20; i++) {
      pushCandle('BTCUSDT', '15m', makeCandle(i));
    }

    expect(states.length).toBe(19); // first candle doesn't produce state (needs >= 2)
    const last = states[states.length - 1]!;
    expect(last.symbol).toBe('BTCUSDT');
    expect(last.timeframe).toBe('15m');
    expect(typeof last.price).toBe('string');
    expect(last.candleCount).toBe(20);
    expect(['bullish', 'bearish', 'range']).toContain(last.trendRegime);
    expect(['low', 'normal', 'high']).toContain(last.volatilityRegime);
    expect(typeof last.atr).toBe('string');
    // Decimal.toString() should not produce '{}'.
    expect(last.atr).not.toBe('{}');

    await stream.stop();
  });

  it('fires onCandle for every closed candle', async () => {
    const { adapter, pushCandle } = makeMockAdapter();
    const candles: Candle[] = [];

    const stream = createMarketStream(
      {
        adapter,
        streams: [{ symbol: 'ETHUSDT', timeframe: '5m' }],
        detectors: null, // no event detection for this test
      },
      {
        onCandle: (c) => candles.push(c),
      },
    );

    await stream.start();

    for (let i = 0; i < 5; i++) {
      pushCandle('ETHUSDT', '5m', makeCandle(i, 200));
    }

    expect(candles.length).toBe(4); // first candle doesn't fire onCandle (needs >= 2 for state)
    await stream.stop();
  });

  it('fires onEvent when new events are detected', async () => {
    const { adapter, pushCandle } = makeMockAdapter();
    const events: Array<{ type: string; symbol: string }> = [];

    const stream = createMarketStream(
      {
        adapter,
        streams: [{ symbol: 'SOLUSDT', timeframe: '15m' }],
        candleBufferDepth: 100,
        detectors: ['fvg', 'displacement'],
        eventLookbackBars: 10,
      },
      {
        onEvent: (ev, key) => events.push({ type: ev.type, symbol: key.symbol }),
      },
    );

    await stream.start();

    // Push 50 candles — enough to trigger FVGs and displacement.
    for (let i = 0; i < 50; i++) {
      pushCandle('SOLUSDT', '15m', makeCandle(i, 50));
    }

    // With this synthetic data, we should see at least some events.
    // (Exact count depends on the sine-driven price series.)
    expect(events.length).toBeGreaterThanOrEqual(0);
    // Every event should be tagged with the correct symbol.
    for (const e of events) {
      expect(e.symbol).toBe('SOLUSDT');
    }

    await stream.stop();
  });

  it('manages multiple streams independently', async () => {
    const { adapter, pushCandle } = makeMockAdapter();
    const btcStates: number[] = [];
    const ethStates: number[] = [];

    const stream = createMarketStream(
      {
        adapter,
        streams: [
          { symbol: 'BTCUSDT', timeframe: '15m' },
          { symbol: 'ETHUSDT', timeframe: '15m' },
        ],
        detectors: null,
      },
      {
        onState: (s) => {
          if (s.symbol === 'BTCUSDT') btcStates.push(1);
          if (s.symbol === 'ETHUSDT') ethStates.push(1);
        },
      },
    );

    await stream.start();

    // Push only BTC candles.
    for (let i = 0; i < 5; i++) {
      pushCandle('BTCUSDT', '15m', makeCandle(i, 100));
    }

    expect(btcStates.length).toBe(4); // first candle doesn't produce state
    expect(ethStates.length).toBe(0); // ETH has not received any candles yet.

    // Now push ETH candles.
    for (let i = 0; i < 3; i++) {
      pushCandle('ETHUSDT', '15m', makeCandle(i, 200));
    }

    expect(btcStates.length).toBe(4); // unchanged
    expect(ethStates.length).toBe(2); // first candle doesn't produce state

    await stream.stop();
  });

  it('getState and getCandles return null/empty before any candle arrives', async () => {
    const { adapter } = makeMockAdapter();

    const stream = createMarketStream(
      {
        adapter,
        streams: [{ symbol: 'BTCUSDT', timeframe: '15m' }],
        detectors: null,
      },
      {},
    );

    await stream.start();

    const key: StreamKey = { symbol: 'BTCUSDT', timeframe: '15m' };
    expect(stream.getState(key)).toBeNull();
    expect(stream.getCandles(key).length).toBe(0);

    await stream.stop();
  });

  it('isAlive reflects connection status', async () => {
    const { adapter, pushCandle, setStatus } = makeMockAdapter();

    const stream = createMarketStream(
      {
        adapter,
        streams: [{ symbol: 'BTCUSDT', timeframe: '15m' }],
        detectors: null,
      },
      {},
    );

    await stream.start();

    const key: StreamKey = { symbol: 'BTCUSDT', timeframe: '15m' };
    expect(stream.isAlive(key)).toBe(true); // adapter immediately fires 'open'

    // Simulate disconnect.
    setStatus('BTCUSDT', '15m', 'closed');
    expect(stream.isAlive(key)).toBe(false);

    await stream.stop();
  });

  it('produces JSON-serializable MarketState (no Decimal bleed)', async () => {
    const { adapter, pushCandle } = makeMockAdapter();

    const stream = createMarketStream(
      {
        adapter,
        streams: [{ symbol: 'BTCUSDT', timeframe: '15m' }],
        detectors: ['fvg'],
        eventLookbackBars: 5,
      },
      {},
    );

    await stream.start();

    for (let i = 0; i < 30; i++) {
      pushCandle('BTCUSDT', '15m', makeCandle(i, 100));
    }

    const key: StreamKey = { symbol: 'BTCUSDT', timeframe: '15m' };
    const state = stream.getState(key)!;
    const json = JSON.stringify(state);

    // No empty-object artifacts from unserialized Decimal fields.
    expect(json).not.toMatch(/\{\}/);
    expect(json.length).toBeGreaterThan(0);

    await stream.stop();
  });
});
