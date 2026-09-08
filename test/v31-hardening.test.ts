import { describe, it, expect } from 'vitest';
import { MarketStateStore } from '../src/engines/market-state-store.js';
import { BinanceMarketStream, type WsFactory, type WsHandlers } from '../src/infrastructure/binance/market-stream.js';
import { CrossVenueGate } from '../src/infrastructure/coindcx/cross-venue-gate.js';
import { strategyCellStage } from '../src/engines/pipeline-stage.js';
import type { PipelineDeps } from '../src/engines/pipeline.js';
import type { Candle } from '../src/domain/market/types.js';

// ---------------------------------------------------------------------------
// MarketStateStore — book ticker
describe('MarketStateStore — book ticker (V3.1 P1)', () => {
  it('stores best bid/ask and exposes them on the snapshot', () => {
    const store = new MarketStateStore();
    store.setBookTicker({ symbol: 'BTCUSDT', bid: 99.5, ask: 100.5, at: 1_000 });
    const snap = store.snapshot('BTCUSDT')!;
    expect(snap.bestBid).toBe(99.5);
    expect(snap.bestAsk).toBe(100.5);
    expect(snap.bestQuoteAt).toBe(1_000);
  });

  it('rejects degenerate quotes (non-finite or crossed-nonpositive)', () => {
    const store = new MarketStateStore();
    store.setBookTicker({ symbol: 'BTCUSDT', bid: -1, ask: 100, at: 1_000 });
    store.setBookTicker({ symbol: 'BTCUSDT', bid: Number.NaN, ask: 100, at: 1_000 });
    expect(store.snapshot('BTCUSDT')?.bestBid).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// BinanceMarketStream — bookTicker subscription + parse
describe('BinanceMarketStream — bookTicker stream (V3.1 P1)', () => {
  const makeStream = (store: MarketStateStore, onMessage: (raw: string) => void) => {
    const factory: WsFactory = (_url: string, handlers: WsHandlers) => {
      handlers.onOpen();
      return { close: (): void => undefined };
    };
    const stream = new BinanceMarketStream({
      store, provider: { getKlines: async (): Promise<Candle[]> => [] } as never,
      wsFactory: factory,
    });
    (stream as unknown as { onMessage: (raw: string) => void }).onMessage = onMessage;
    return stream;
  };

  it('subscribes to the bookTicker multiplex stream', async () => {
    const store = new MarketStateStore();
    let url = '';
    const factory: WsFactory = (u: string, handlers: WsHandlers) => {
      url = u;
      handlers.onOpen();
      return { close: (): void => undefined };
    };
    const stream = new BinanceMarketStream({
      store, provider: { getKlines: async (): Promise<Candle[]> => [] } as never,
      wsFactory: factory,
    });
    await stream.subscribe(['BTCUSDT']);
    expect(url).toContain('btcusdt@bookTicker');
  });

  it('parses {s,b,a} payloads into store top-of-book', () => {
    const store = new MarketStateStore();
    const stream = new BinanceMarketStream({
      store, provider: { getKlines: async (): Promise<Candle[]> => [] } as never,
      wsFactory: (_u, _h) => ({ close: (): void => undefined }),
    });
    stream['onMessage'](JSON.stringify({
      stream: 'btcusdt@bookTicker',
      data: { e: 'bookTicker', s: 'BTCUSDT', b: '99000.5', B: '1', a: '99001.0', A: '2' },
    }));
    const snap = store.snapshot('BTCUSDT')!;
    expect(snap.bestBid).toBeCloseTo(99_000.5, 6);
    expect(snap.bestAsk).toBeCloseTo(99_001.0, 6);
  });
});

// ---------------------------------------------------------------------------
// CrossVenueGate — real bid/ask preferred over the last-price proxy
describe('CrossVenueGate — binanceQuote source (V3.1 P1)', () => {
  const book = {
    bids: { '100.0': '1' }, asks: { '100.2': '1' }, timestamp: Date.now(),
  };
  const deps = (quote: { bid: number; ask: number; at: number } | undefined) => ({
    client: {
      futures: { market: { getOrderBook: async (): Promise<unknown> => book } },
    },
    router: { resolve: async (): Promise<unknown> => ({ pair: 'B-BTC_USDT', quote: 'USDT', fxRate: 1 }) },
    binanceTicker: async (): Promise<number> => 100.1,
    binanceQuote: quote ? (): { bid: number; ask: number; at: number } => quote : undefined,
  });

  it('uses the real book quote when fresh (annotated book_ticker)', async () => {
    const gate = new CrossVenueGate(
      deps({ bid: 100.0, ask: 100.1, at: Date.now() }) as never, {}
    );
    const result = await gate.evaluate('BTCUSDT');
    expect(result.state?.binanceQuoteSource).toBe('book_ticker');
    expect(result.state?.binance.bid).toBe(100.0);
    expect(result.state?.binance.ask).toBe(100.1);
    expect(result.state?.binanceSpreadBps).toBeCloseTo(9.995, 2); // real spread
  });

  it('falls back to the last-price proxy when absent/stale (annotated)', async () => {
    const gate = new CrossVenueGate(deps(undefined) as never, {});
    const result = await gate.evaluate('BTCUSDT');
    expect(result.state?.binanceQuoteSource).toBe('last_proxy');
    expect(result.state?.binance.bid).toBe(100.1);
    expect(result.state?.binance.ask).toBe(100.1);

    const staleGate = new CrossVenueGate(
      deps({ bid: 100.0, ask: 100.1, at: Date.now() - 60_000 }) as never, {}
    );
    const stale = await staleGate.evaluate('BTCUSDT');
    expect(stale.state?.binanceQuoteSource).toBe('last_proxy');
  });
});

// ---------------------------------------------------------------------------
// Pipeline — strategy cell gate
describe('Pipeline strategy-cell gate (V3.1 P0-5)', () => {
  const depsWith = (
    gate: NonNullable<PipelineDeps['strategyGate']> | undefined
  ): Pick<PipelineDeps, 'strategyGate' | 'store'> => {
    const store = {
      append: (e: { type: string; payload?: unknown }): void => {
        (store as unknown as { events: unknown[] }).events ??= [];
        (store as unknown as { events: unknown[] }).events.push(e);
      },
    };
    return { strategyGate: gate, store: store as unknown as PipelineDeps['store'] };
  };

  it('allows when no gate is installed (bootstrap / dry pipelines)', () => {
    const deps = depsWith(undefined);
    expect(strategyCellStage(deps as PipelineDeps, {} as never, {
      setupType: 'PULLBACK_RECLAIM',
    } as never, 'TREND_UP')).toBe(true);
  });

  it('rejects and audits cells the research gate did not approve', () => {
    const deps = depsWith(
      (strategyId: string, setupType: string, regime: string) => {
        void strategyId;
        return setupType === 'PULLBACK_RECLAIM' && regime === 'TREND_UP'
          ? { allowed: true }
          : { allowed: false, reason: 'cell not approved' };
      }
    );
    const trace = { symbol: 'BTCUSDT' };
    const approved = strategyCellStage(deps as PipelineDeps, trace as never, {
      setupType: 'PULLBACK_RECLAIM',
    } as never, 'TREND_UP');
    const blocked = strategyCellStage(deps as PipelineDeps, trace as never, {
      setupType: 'SR_BREAK',
    } as never, 'RANGE');
    expect(approved).toBe(true);
    expect(blocked).toBe(false);
    const events = (deps.store as unknown as { events: { type: string; payload: Record<string, unknown> }[] }).events;
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('strategy.cell_rejected');
    expect(events[0].payload.cell).toBe('SR_BREAK|RANGE');
  });
});
