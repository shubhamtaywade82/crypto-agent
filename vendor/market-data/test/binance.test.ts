import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Decimal } from 'decimal.js';

import { BinanceRestAdapter } from '../src/binance/rest.js';
import { BinanceKlineStream } from '../src/binance/ws.js';
import { createBinanceAdapter } from '../src/binance/adapter.js';
import { createExchangeAdapter } from '../src/index.js';
import * as http from '../src/http.js';

/* ------------------------------------------------------------------ *
 * Helpers
 * ------------------------------------------------------------------ */

function rawKline(
  openTime: number,
  o: string,
  h: string,
  l: string,
  c: string,
  v: string,
  closeTime: number,
) {
  return [openTime, o, h, l, c, v, closeTime, '', 0, '', '', ''];
}

function mockHttpGetJson(
  responseByPath: Record<string, unknown>,
): ReturnType<typeof vi.fn> {
  return vi
    .spyOn(http, 'httpGetJson')
    .mockImplementation(async (opts: http.HttpGetOptions) => {
      const url = new URL(opts.url);
      const key = `${url.pathname}?${url.searchParams.toString()}`;
      const matched = Object.entries(responseByPath).find(([prefix]) =>
        key.startsWith(prefix),
      );
      if (!matched) {
        throw new http.HttpFatalError(`Unexpected URL: ${key}`, 404);
      }
      return matched[1] as never;
    });
}

/* ------------------------------------------------------------------ *
 * Binance REST adapter tests
 * ------------------------------------------------------------------ */

describe('market-data / BinanceRestAdapter', () => {
  let spy: ReturnType<typeof vi.fn> | undefined;

  beforeEach(() => {
    spy = undefined;
  });

  afterEach(() => {
    spy?.mockRestore();
    vi.restoreAllMocks();
  });

  it('fetchKlines paginates and normalizes to Decimal-typed Candles', async () => {
    spy = mockHttpGetJson({
      '/api/v3/klines?symbol=ETHUSDT&interval=15m&startTime=1000&endTime=5000&limit=2': [
        rawKline(1000, '100', '102', '99', '101', '10', 1099),
        rawKline(2000, '101', '103', '100', '102', '12', 2099),
      ],
      '/api/v3/klines?symbol=ETHUSDT&interval=15m&startTime=2100&endTime=5000&limit=2': [
        rawKline(3000, '102', '104', '101', '103', '14', 3099),
      ],
    });

    const adapter = new BinanceRestAdapter({ spotRestBaseUrl: 'https://mock' });
    const candles = await adapter.fetchKlines({
      symbol: 'ETHUSDT',
      timeframe: '15m',
      startTime: 1000,
      endTime: 5000,
      batchLimit: 2,
    });

    expect(candles.length).toBe(3);
    expect(candles[0]!.timestamp).toBe(1000);
    expect(candles[0]!.open.equals(new Decimal('100'))).toBe(true);
    expect(candles[0]!.close.equals(new Decimal('101'))).toBe(true);
    expect(candles[0]!.timestamp).toBeLessThan(candles[1]!.timestamp);
    expect(candles[1]!.timestamp).toBeLessThan(candles[2]!.timestamp);
  });

  it('fetchKlines uses USD-M futures endpoint when klineMarket is usdm_futures', async () => {
    spy = mockHttpGetJson({
      '/fapi/v1/klines?symbol=BTCUSDT&interval=15m&startTime=1000&endTime=5000&limit=1500': [
        rawKline(1000, '100', '102', '99', '101', '10', 1099),
      ],
    });

    const adapter = new BinanceRestAdapter({
      spotRestBaseUrl: 'https://mock-spot',
      futuresRestBaseUrl: 'https://mock-fapi',
      klineMarket: 'usdm_futures',
    });
    const candles = await adapter.fetchKlines({
      symbol: 'BTCUSDT',
      timeframe: '15m',
      startTime: 1000,
      endTime: 5000,
    });

    expect(candles.length).toBe(1);
    expect(spy).toHaveBeenCalled();
  });

  it('deduplicates candles with the same timestamp across pages', async () => {
    spy = mockHttpGetJson({
      '/api/v3/klines?symbol=ETHUSDT&interval=1m&startTime=0&endTime=10000&limit=2': [
        rawKline(1000, '1', '2', '0.5', '1.5', '10', 1099),
        rawKline(2000, '1.5', '2.5', '1', '2', '11', 2099),
      ],
      '/api/v3/klines?symbol=ETHUSDT&interval=1m&startTime=2100&endTime=10000&limit=2': [
        rawKline(2000, '1.5', '2.5', '1', '2', '11', 2099), // dup
        rawKline(3000, '2', '3', '1.5', '2.5', '12', 3099),
      ],
      '/api/v3/klines?symbol=ETHUSDT&interval=1m&startTime=3100&endTime=10000&limit=2': [
        rawKline(4000, '2.5', '3.5', '2', '3', '13', 4099),
      ],
    });

    const adapter = new BinanceRestAdapter({ spotRestBaseUrl: 'https://mock' });
    const candles = await adapter.fetchKlines({
      symbol: 'ETHUSDT',
      timeframe: '1m',
      startTime: 0,
      endTime: 10_000,
      batchLimit: 2,
    });

    expect(candles.length).toBe(4);
    const timestamps = candles.map((c) => c.timestamp);
    expect(timestamps).toEqual([1000, 2000, 3000, 4000]);
  });

  it('fetchFundingRate returns null for spot-only symbols (HTTP 400)', async () => {
    spy = vi.spyOn(http, 'httpGetJson').mockImplementation(async () => {
      throw new http.HttpTransientError('Bad request', 400);
    });

    const adapter = new BinanceRestAdapter({ futuresRestBaseUrl: 'https://mock' });
    const result = await adapter.fetchFundingRate('ETHUSDT');
    expect(result).toBeNull();
  });

  it('fetchFundingRate parses funding rate response', async () => {
    spy = mockHttpGetJson({
      '/fapi/v1/premiumIndex?symbol=ETHUSDT': {
        symbol: 'ETHUSDT',
        markPrice: '50000.0',
        indexPrice: '49999.0',
        lastFundingRate: '0.0001',
        time: 1700000000000,
      },
    });

    const adapter = new BinanceRestAdapter({ futuresRestBaseUrl: 'https://mock' });
    const result = await adapter.fetchFundingRate('ETHUSDT');
    expect(result).not.toBeNull();
    expect(result!.symbol).toBe('ETHUSDT');
    expect(result!.fundingRate).toBeCloseTo(0.0001, 10);
    expect(result!.markPrice).toBeCloseTo(50_000, 1);
  });

  it('fetchOpenInterest parses OI response', async () => {
    spy = mockHttpGetJson({
      '/fapi/v1/openInterest?symbol=ETHUSDT': {
        openInterest: '100000.5',
        time: 1700000000000,
      },
    });

    const adapter = new BinanceRestAdapter({ futuresRestBaseUrl: 'https://mock' });
    const result = await adapter.fetchOpenInterest('ETHUSDT');
    expect(result).not.toBeNull();
    expect(result!.openInterest).toBeCloseTo(100_000.5, 1);
  });
});

/* ------------------------------------------------------------------ *
 * createExchangeAdapter factory tests
 * ------------------------------------------------------------------ */

describe('market-data / createExchangeAdapter', () => {
  it('creates a Binance adapter with the correct exchange id', () => {
    const adapter = createExchangeAdapter('binance');
    expect(adapter.exchange).toBe('binance');
    expect(adapter.restBaseUrl).toContain('binance.com');
  });

  it('creates a Bybit adapter that throws on subscribeKlines (WS not yet implemented)', async () => {
    const adapter = createExchangeAdapter('bybit');
    expect(adapter.exchange).toBe('bybit');
    await expect(
      adapter.subscribeKlines({
        symbol: 'ETHUSDT',
        timeframe: '15m',
        onCandle: () => { },
      }),
    ).rejects.toThrow(/WebSocket adapter not yet implemented/);
  });

  it('throws on unknown exchange', () => {
    expect(() =>
      createExchangeAdapter('kraken' as 'binance'),
    ).toThrow(/Unknown exchange/);
  });
});

/* ------------------------------------------------------------------ *
 * BinanceKlineStream tests
 *
 * vi.mock must be at top level (Vitest hoists it). We use vi.hoisted to
 * create shared state that the mock factory can access.
 * ------------------------------------------------------------------ */

const { mockHandlers } = vi.hoisted(() => ({
  mockHandlers: {} as Record<string, ((...args: unknown[]) => void)[]>,
}));

vi.mock('ws', () => ({
  WebSocket: class {
    constructor() { }
    on(event: string, handler: (...args: unknown[]) => void) {
      (mockHandlers[event] ??= []).push(handler);
    }
    once(event: string, handler: (...args: unknown[]) => void) {
      (mockHandlers[event] ??= []).push(handler);
    }
    close() {
      mockHandlers['close']?.forEach((h) => h());
    }
  },
}));

describe('market-data / BinanceKlineStream', () => {
  beforeEach(() => {
    for (const k of Object.keys(mockHandlers)) delete mockHandlers[k]!;
  });

  it('normalizes closed kline messages to Candle and ignores in-progress candles', async () => {
    const receivedCandles: unknown[] = [];
    const statuses: string[] = [];

    const stream = new BinanceKlineStream(
      {
        symbol: 'ETHUSDT',
        timeframe: '15m',
        onCandle: (c) => receivedCandles.push(c),
        onStatus: (s) => statuses.push(s),
      },
      { wsBaseUrl: 'wss://mock' },
    );

    const connectPromise = stream.connect();
    mockHandlers['open']?.forEach((h) => h());
    await connectPromise;

    // In-progress kline (x=false) — should be ignored.
    mockHandlers['message']?.forEach((h) =>
      h(
        Buffer.from(
          JSON.stringify({
            e: 'kline',
            E: 1,
            s: 'ETHUSDT',
            k: {
              t: 1000, T: 1099, s: 'ETHUSDT', i: '15m',
              o: '100', c: '101', h: '102', l: '99', v: '10',
              x: false, q: '',
            },
          }),
        ),
      ),
    );
    expect(receivedCandles.length).toBe(0);

    // Closed kline (x=true) — should be forwarded.
    mockHandlers['message']?.forEach((h) =>
      h(
        Buffer.from(
          JSON.stringify({
            e: 'kline',
            E: 2,
            s: 'ETHUSDT',
            k: {
              t: 1000, T: 1099, s: 'ETHUSDT', i: '15m',
              o: '100', c: '101', h: '102', l: '99', v: '10',
              x: true, q: '',
            },
          }),
        ),
      ),
    );

    expect(receivedCandles.length).toBe(1);
    const candle = receivedCandles[0] as {
      timestamp: number;
      open: { equals: (d: Decimal) => boolean };
    };
    expect(candle.timestamp).toBe(1000);
    expect(candle.open.equals(new Decimal('100'))).toBe(true);

    expect(statuses).toContain('connecting');
    expect(statuses).toContain('open');

    await stream.unsubscribe();
  });
});
