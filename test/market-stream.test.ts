import { describe, it, expect, vi, afterEach } from 'vitest';
import { BinanceMarketStream, type WsFactory, type WsHandlers } from '../src/infrastructure/binance/market-stream.js';
import { MarketStateStore } from '../src/engines/market-state-store.js';
import { EventStore } from '../src/infrastructure/events/event-store.js';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { IMarketDataProvider } from '../src/infrastructure/broker/broker.js';

const tempStore = (): EventStore =>
  new EventStore({ filePath: join(mkdtempSync(join(tmpdir(), 'ws-')), 'events.jsonl') });

/** Scripted socket: test drives open/message/close; captures the URL. */
class FakeSocket {
  static last?: FakeSocket;
  readonly url: string;
  private readonly handlers: WsHandlers;
  constructor(url: string, handlers: WsHandlers) {
    this.url = url;
    this.handlers = handlers;
    FakeSocket.last = this;
  }
  open(): void {
    this.handlers.onOpen();
  }
  message(raw: string): void {
    this.handlers.onMessage(raw);
  }
  close(reason = '1006'): void {
    this.handlers.onClose(reason);
  }
  dispose(): void {
    this.handlers.onClose('disposed');
  }
}

interface Harness {
  readonly stream: BinanceMarketStream;
  readonly store: MarketStateStore;
  readonly audit: EventStore;
  readonly provider: IMarketDataProvider;
  readonly klinesRequested: string[];
}

const harness = (opts?: { maxRetries?: number }): Harness => {
  const store = new MarketStateStore();
  const audit = tempStore();
  const klinesRequested: string[] = [];
  const provider: IMarketDataProvider = {
    id: 'test',
    capabilities: ['MARKET_DATA'],
    getKlines: async (symbol, tf) => {
      klinesRequested.push(`${symbol}:${tf}`);
      return [{ openTime: 1, open: 100, high: 110, low: 90, close: 105, volume: 10 }];
    },
    getTickerPrice: async () => 105,
    getMarkIndex: async () => ({ mark: 104, index: 103 }),
    getFundingRate: async () => 0.0001,
    getOpenInterest: async () => ({ oi: 1, changePct: 0 }),
  } as unknown as IMarketDataProvider;
  const factory: WsFactory = (url, handlers) => new FakeSocket(url, handlers);
  const stream = new BinanceMarketStream({
    store, provider, audit, wsFactory: factory, maxRetries: opts?.maxRetries ?? 2,
    backoffBaseMs: 1, backoffCapMs: 2, now: () => 1_000,
  });
  return { stream, store, audit, provider, klinesRequested };
};

const klineMsg = (symbol: string, close: number, interval = '5m'): string =>
  JSON.stringify({
    stream: `${symbol.toLowerCase()}@kline_${interval}`,
    data: {
      e: 'kline', E: 1, s: symbol,
      k: { t: 1000, T: 1299999, s: symbol, i: interval, o: '100', c: String(close), h: '106', l: '99', v: '12', n: 50, x: false, q: '1260', V: '6', Q: '630' },
    },
  });

const markMsg = (symbol: string): string =>
  JSON.stringify({
    stream: `${symbol.toLowerCase()}@markPrice@1s`,
    data: { e: 'markPriceUpdate', E: 2, s: symbol, p: '104.5', i: '104.1', P: '104.2', r: '0.0001', T: 3 },
  });

afterEach(() => {
  FakeSocket.last = undefined;
  vi.useRealTimers();
});

describe('BinanceMarketStream — live path', () => {
  it('backfills ladders over REST then goes LIVE and feeds the store', async () => {
    const h = harness();
    await h.stream.subscribe(['BTCUSDT']);
    const socket = FakeSocket.last!;
    expect(socket.url).toContain('btcusdt@kline_5m');
    expect(socket.url).toContain('btcusdt@markPrice@1s');
    expect(socket.url).toContain('btcusdt@miniTicker');
    expect(h.klinesRequested).toContain('BTCUSDT:5m');
    expect(h.stream.state).toBe('CONNECTING');
    socket.open();
    expect(h.stream.state).toBe('LIVE');
    socket.message(klineMsg('BTCUSDT', 107));
    socket.message(markMsg('BTCUSDT'));
    const snap = h.store.snapshot('BTCUSDT')!;
    // REST backfill ladder (openTime=1) + WS candle (openTime=1000) coexist.
    expect(snap.candles['5m']).toHaveLength(2);
    expect(snap.candles['5m'].at(-1)!.close).toBe(107);
    expect(snap.mark).toBe(104.5);
    expect(snap.fundingRate).toBe(0.0001);
    h.stream.stop();
  });

  it('records connect/down audit events', async () => {
    const h = harness();
    await h.stream.subscribe(['BTCUSDT']);
    const socket = FakeSocket.last!;
    socket.open();
    socket.close('1006 abnormal');
    const types = h.audit.readAll(50).map((e) => e.type);
    expect(types).toContain('market.stream.state');
    expect(types).toContain('market.stream.down');
    h.stream.stop();
  });
});

describe('BinanceMarketStream — resilience', () => {
  it('reconnects with backoff and reuses the same URL (resubscribe)', async () => {
    vi.useFakeTimers();
    const h = harness();
    await h.stream.subscribe(['BTCUSDT']);
    const first = FakeSocket.last!;
    first.open();
    first.close('reset');
    expect(h.stream.state).toBe('DOWN');
    await vi.advanceTimersByTimeAsync(50);
    const second = FakeSocket.last!;
    expect(second).not.toBe(first);
    expect(second.url).toBe(first.url);
    expect(h.stream.status().attempts).toBe(1);
    h.stream.stop();
  });

  it('gives up after maxRetries and stays DOWN (REST serves data)', async () => {
    vi.useFakeTimers();
    const h = harness({ maxRetries: 2 });
    await h.stream.subscribe(['BTCUSDT']);
    for (let i = 0; i < 3; i++) {
      await vi.advanceTimersByTimeAsync(50);
      FakeSocket.last!.close('reset');
    }
    expect(h.stream.state).toBe('DOWN');
    const sockets = h.stream.status().attempts;
    expect(sockets).toBe(2);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(h.stream.status().attempts).toBe(2); // no further reconnects
    h.stream.stop();
  });

  it('stop() cancels pending reconnects', async () => {
    vi.useFakeTimers();
    const h = harness();
    await h.stream.subscribe(['BTCUSDT']);
    FakeSocket.last!.close('reset');
    h.stream.stop();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(h.stream.state).toBe('IDLE');
  });

  it('ignores malformed payloads without dying', async () => {
    const h = harness();
    await h.stream.subscribe(['BTCUSDT']);
    const socket = FakeSocket.last!;
    socket.open();
    expect(() => socket.message('not-json')).not.toThrow();
    expect(() => socket.message(JSON.stringify({ stream: 'btcusdt@bogus', data: {} }))).not.toThrow();
    socket.message(klineMsg('BTCUSDT', 111));
    expect(h.store.snapshot('BTCUSDT')!.candles['5m'].at(-1)!.close).toBe(111);
    h.stream.stop();
  });
});
