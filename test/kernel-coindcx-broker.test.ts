import { describe, it, expect, vi, afterEach } from 'vitest';
import { CoinDCXExecutionBroker } from '../src/infrastructure/coindcx/execution-broker.js';
import type { CoinDCXClient } from '@nemesis-oss/coindcx-sdk';

interface OrderShape {
  id: number;
  pair: string;
  status: string;
  filled_quantity?: number;
  price?: number;
  client_order_id?: string;
}

type MockFn = ReturnType<typeof vi.fn>;

interface MockClient {
  futures: {
    market: { getMarketsDetails: MockFn };
    trading: { createOrder: MockFn; listOrders: MockFn };
  };
  setSafetyLimits: MockFn;
}

/** Field values copied from CoinDCX captures of markets_details. */
const MARKET_ROWS: readonly Record<string, unknown>[] = [
  { pair: 'B-SOL_USDT', status: 'active', step: 0.001, min_quantity: 0.001, max_quantity: 90000, min_notional: 5, max_leverage: 0, max_leverage_short: 0 },
  { pair: 'B-ETH_USDT', status: 'active', step: 0.0001, min_quantity: 0.0001, max_quantity: 9000, min_notional: 5, max_leverage: 0, max_leverage_short: 0 },
  { pair: 'B-XRP_USDT', status: 'active', step: 0.1, min_quantity: 0.1, max_quantity: 9222449, min_notional: 5, max_leverage: 0, max_leverage_short: 0 },
];

/** Field values copied from CoinDCX captures of derivatives/futures/data/instrument. */
const FUTURES_ROWS: Record<string, Record<string, unknown>> = {
  'B-SOL_USDT': {
    pair: 'B-SOL_USDT', status: 'active', kind: 'perpetual', margin_currency_short_name: 'USDT',
    position_currency_short_name: 'SOL', price_increment: 0.01, quantity_increment: 0.01,
    min_quantity: 0.01, max_quantity: 950000, min_notional: 6, max_leverage_long: 5, max_leverage_short: 5,
  },
  'B-ETH_USDT': {
    pair: 'B-ETH_USDT', status: 'active', kind: 'perpetual', margin_currency_short_name: 'USDT',
    position_currency_short_name: 'ETH', price_increment: 0.01, quantity_increment: 0.001,
    min_quantity: 0.001, max_quantity: 9500, min_notional: 24, max_leverage_long: 20, max_leverage_short: 20,
  },
  'B-XRP_USDT': {
    pair: 'B-XRP_USDT', status: 'active', kind: 'perpetual', margin_currency_short_name: 'USDT',
    position_currency_short_name: 'XRP', price_increment: 0.0001, quantity_increment: 0.1,
    min_quantity: 0.1, max_quantity: 9500000, min_notional: 6, max_leverage_long: 10, max_leverage_short: 10,
  },
};

/** Public futures-instrument endpoint stub; answers by the `pair` query parameter, as the venue does. */
const stubFuturesEndpoint = (rows: Record<string, Record<string, unknown>> = FUTURES_ROWS) => {
  const fetchMock = vi.fn(async (input: string | URL): Promise<Response> => {
    const url = new URL(String(input));
    const row = rows[url.searchParams.get('pair') ?? ''];
    if (!row) return new Response('{}', { status: 404 });
    return new Response(JSON.stringify({ instrument: row }), {
      status: 200, headers: { 'content-type': 'application/json' },
    });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
};

const makeClient = (markets: readonly unknown[] = MARKET_ROWS): MockClient => ({
  futures: {
    market: { getMarketsDetails: vi.fn().mockResolvedValue(markets) },
    trading: {
      createOrder: vi.fn().mockResolvedValue({
        id: 1, pair: 'B-SOL_USDT', status: 'filled', filled_quantity: 1, price: 150,
      }),
      listOrders: vi.fn().mockResolvedValue([]),
    },
  },
  setSafetyLimits: vi.fn(),
});

const asClient = (client: MockClient): CoinDCXClient => client as unknown as CoinDCXClient;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('CoinDCXExecutionBroker — truthful order lookups', () => {
  it('returns FOUND when the client_order_id is in the recent orders page', async () => {
    const client = makeClient();
    const order: OrderShape = {
      id: 7, pair: 'B-SOL_USDT', status: 'open',
      filled_quantity: 0, client_order_id: 'decision_1',
    };
    client.futures.trading.listOrders.mockResolvedValue([order]);

    const broker = new CoinDCXExecutionBroker(asClient(client));
    const result = await broker.lookupOrder('B-SOL_USDT', 'decision_1');
    expect(result.kind).toBe('FOUND');
  });

  it('returns NOT_FOUND only when the venue affirmatively answers twice', async () => {
    const client = makeClient();
    client.futures.trading.listOrders.mockResolvedValue([]);
    const broker = new CoinDCXExecutionBroker(asClient(client));
    const result = await broker.lookupOrder('B-SOL_USDT', 'decision_missing');
    expect(result.kind).toBe('NOT_FOUND');
  });

  it('returns LOOKUP_FAILED on venue errors — NEVER NOT_FOUND (old bug)', async () => {
    const client = makeClient();
    client.futures.trading.listOrders.mockRejectedValue(new Error('HTTP 503'));
    const broker = new CoinDCXExecutionBroker(asClient(client));
    const result = await broker.lookupOrder('B-SOL_USDT', 'decision_x');
    expect(result.kind).toBe('LOOKUP_FAILED');
    if (result.kind === 'LOOKUP_FAILED') expect(result.reason).toContain('HTTP 503');
  });
});

describe('CoinDCXExecutionBroker — venue spec is the stricter-of-both merge', () => {
  it.each([
    ['B-SOL_USDT', { tickSize: 0.01, lotSize: 0.01, minQuantity: 0.01, maxQuantity: 90000, minNotional: 6, maxLeverage: 5 }],
    ['B-ETH_USDT', { tickSize: 0.01, lotSize: 0.001, minQuantity: 0.001, maxQuantity: 9000, minNotional: 24, maxLeverage: 20 }],
    ['B-XRP_USDT', { tickSize: 0.0001, lotSize: 0.1, minQuantity: 0.1, maxQuantity: 9222449, minNotional: 6, maxLeverage: 10 }],
  ])('%s takes the stricter value of every shared constraint', async (pair, expected) => {
    stubFuturesEndpoint();
    const broker = new CoinDCXExecutionBroker(asClient(makeClient()));
    const spec = await broker.getInstrument(pair);
    expect(spec).toMatchObject({ pair, baseAsset: pair.slice(2, 5), quoteAsset: 'USDT', ...expected });
  });

  it('queries the public perpetual instrument endpoint with the pair and USDT margin', async () => {
    const fetchMock = stubFuturesEndpoint();
    const broker = new CoinDCXExecutionBroker(asClient(makeClient()));
    await broker.getInstrument('B-SOL_USDT');
    const url = new URL(String(fetchMock.mock.calls[0]?.[0]));
    expect(url.origin + url.pathname).toBe('https://api.coindcx.com/exchange/v1/derivatives/futures/data/instrument');
    expect(url.searchParams.get('pair')).toBe('B-SOL_USDT');
    expect(url.searchParams.get('margin_currency_short_name')).toBe('USDT');
  });

  it('returns undefined without touching the futures endpoint when markets_details does not list the pair', async () => {
    const fetchMock = stubFuturesEndpoint();
    const broker = new CoinDCXExecutionBroker(asClient(makeClient()));
    expect(await broker.getInstrument('B-FAKE_USDT')).toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('fails the lookup when the futures endpoint answers non-2xx', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('down', { status: 503 })));
    const broker = new CoinDCXExecutionBroker(asClient(makeClient()));
    await expect(broker.getInstrument('B-SOL_USDT')).rejects.toThrow(/HTTP 503/);
  });

  it('refuses an instrument that is not an active USDT perpetual', async () => {
    stubFuturesEndpoint({ 'B-SOL_USDT': { ...FUTURES_ROWS['B-SOL_USDT'], kind: 'dated' } });
    const broker = new CoinDCXExecutionBroker(asClient(makeClient()));
    await expect(broker.getInstrument('B-SOL_USDT')).rejects.toThrow(/not an active USDT perpetual/);
  });

  it('rejects a markets_details row that violates the schema instead of sizing with it', async () => {
    stubFuturesEndpoint();
    const broker = new CoinDCXExecutionBroker(asClient(makeClient([{ ...MARKET_ROWS[0], step: 0 }])));
    await expect(broker.getInstrument('B-SOL_USDT')).rejects.toThrow(/schema validation/);
  });

  it('propagates a markets_details failure instead of degrading to a fallback spec', async () => {
    const client = makeClient();
    client.futures.market.getMarketsDetails.mockRejectedValue(new Error('rate limited'));
    const broker = new CoinDCXExecutionBroker(asClient(client));
    await expect(broker.getInstrument('B-SOL_USDT')).rejects.toThrow('rate limited');
  });
});

describe('CoinDCXExecutionBroker — FX with TTL', () => {
  it('caches the FX rate within the fresh window and re-fetches after', async () => {
    vi.useFakeTimers();
    try {
      const client = makeClient();
      const fx = vi.fn().mockResolvedValue(88);
      const broker = new CoinDCXExecutionBroker(asClient(client), {
        fxProvider: fx, fxFreshMs: 1_000, fxStaleMs: 10_000,
      });
      await broker.convertPrice('B-SOL_INR', 100);
      expect(fx).toHaveBeenCalledTimes(1);
      await broker.convertPrice('B-SOL_INR', 100);
      expect(fx).toHaveBeenCalledTimes(1); // fresh cache

      vi.advanceTimersByTime(2_000);
      await broker.convertPrice('B-SOL_INR', 100);
      expect(fx).toHaveBeenCalledTimes(2); // refreshed after TTL
    } finally {
      vi.useRealTimers();
    }
  });

  it('refuses to price an INR order when FX is expired and unreachable', async () => {
    vi.useFakeTimers();
    try {
      const client = makeClient();
      const fx = vi.fn().mockRejectedValue(new Error('tickers down'));
      const broker = new CoinDCXExecutionBroker(asClient(client), {
        fxProvider: fx, fxFreshMs: 1_000, fxStaleMs: 2_000,
      });
      await expect(broker.convertPrice('B-SOL_INR', 100)).rejects.toThrow('tickers down');
      vi.advanceTimersByTime(60_000);
      await expect(broker.convertPrice('B-SOL_INR', 100)).rejects.toThrow(/cache expired/);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('CoinDCXExecutionBroker — guarded market orders', () => {
  const guardedBuy = {
    intentId: 'decision_buy', pair: 'B-SOL_USDT', side: 'buy' as const,
    orderType: 'market_order' as const, quantity: 1, leverage: 5,
    marginType: 'isolated' as const, expectedPrice: 116.4, maxSlippageBps: 25,
  };

  it('turns a guarded BUY into an IOC limit at the worst price, floored onto the tick', async () => {
    stubFuturesEndpoint();
    const client = makeClient();
    const broker = new CoinDCXExecutionBroker(asClient(client));
    await broker.placeOrder(guardedBuy);
    const call = client.futures.trading.createOrder.mock.calls[0]?.[0];
    expect(call.order_type).toBe('limit_order');
    expect(call.time_in_force).toBe('ioc');
    // 116.4 * 1.0025 = 116.691 -> floor to 0.01 keeps the limit inside the band.
    expect(call.price).toBeCloseTo(116.69, 6);
  });

  it('turns a guarded SELL into an IOC limit at the worst price, ceiled onto the tick', async () => {
    stubFuturesEndpoint();
    const client = makeClient();
    const broker = new CoinDCXExecutionBroker(asClient(client));
    await broker.placeOrder({ ...guardedBuy, intentId: 'decision_sell', side: 'sell' });
    const call = client.futures.trading.createOrder.mock.calls[0]?.[0];
    // 116.4 * 0.9975 = 116.109 -> ceil to 0.01 keeps the limit inside the band.
    expect(call.price).toBeCloseTo(116.11, 6);
  });

  it('caches the venue tick per pair instead of re-reading markets on every order', async () => {
    stubFuturesEndpoint();
    const client = makeClient();
    const broker = new CoinDCXExecutionBroker(asClient(client));
    await broker.placeOrder(guardedBuy);
    await broker.placeOrder({ ...guardedBuy, intentId: 'decision_buy_2' });
    expect(client.futures.market.getMarketsDetails).toHaveBeenCalledTimes(1);
  });

  it('refuses a guarded order whose instrument the venue does not list, sending nothing', async () => {
    stubFuturesEndpoint();
    const client = makeClient([]);
    const broker = new CoinDCXExecutionBroker(asClient(client));
    await expect(broker.placeOrder(guardedBuy)).rejects.toThrow(/unknown at CoinDCX/);
    expect(client.futures.trading.createOrder).not.toHaveBeenCalled();
  });

  it('passes plain market orders through unchanged, without a tick lookup', async () => {
    const client = makeClient();
    const broker = new CoinDCXExecutionBroker(asClient(client));
    await broker.placeOrder({
      intentId: 'decision_plain', pair: 'B-SOL_USDT', side: 'sell',
      orderType: 'market_order', quantity: 1, leverage: 5, marginType: 'isolated',
    });
    const call = client.futures.trading.createOrder.mock.calls[0]?.[0];
    expect(call.order_type).toBe('market_order');
    expect(call.time_in_force).toBe('ioc');
    expect(call.price).toBeUndefined();
    expect(client.futures.market.getMarketsDetails).not.toHaveBeenCalled();
  });
});
