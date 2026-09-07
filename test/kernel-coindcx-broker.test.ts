import { describe, it, expect, vi } from 'vitest';
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

const makeClient = (): CoinDCXClient & {
  futures: {
    market: { getInstrumentDetails: ReturnType<typeof vi.fn> };
    trading: {
      createOrder: ReturnType<typeof vi.fn>;
      listOrders: ReturnType<typeof vi.fn>;
    };
  };
  setSafetyLimits: ReturnType<typeof vi.fn>;
} =>
  ({
    futures: {
      market: { getInstrumentDetails: vi.fn() },
      trading: {
        createOrder: vi.fn().mockResolvedValue({
          id: 1, pair: 'B-SOL_USDT', status: 'filled', filled_quantity: 1, price: 150,
        }),
        listOrders: vi.fn().mockResolvedValue([]),
      },
    },
    setSafetyLimits: vi.fn(),
  }) as unknown as CoinDCXClient & {
    futures: {
      market: { getInstrumentDetails: ReturnType<typeof vi.fn> };
      trading: { createOrder: ReturnType<typeof vi.fn>; listOrders: ReturnType<typeof vi.fn> };
    };
    setSafetyLimits: ReturnType<typeof vi.fn>;
  };

describe('CoinDCXExecutionBroker — truthful order lookups', () => {
  it('returns FOUND when the client_order_id is in the recent orders page', async () => {
    const client = makeClient();
    const order: OrderShape = {
      id: 7, pair: 'B-SOL_USDT', status: 'open',
      filled_quantity: 0, client_order_id: 'decision_1',
    };
    client.futures.trading.listOrders.mockResolvedValue([order]);

    const broker = new CoinDCXExecutionBroker(client);
    const result = await broker.lookupOrder('B-SOL_USDT', 'decision_1');
    expect(result.kind).toBe('FOUND');
  });

  it('returns NOT_FOUND only when the venue affirmatively answers twice', async () => {
    const client = makeClient();
    client.futures.trading.listOrders.mockResolvedValue([]);
    const broker = new CoinDCXExecutionBroker(client);
    const result = await broker.lookupOrder('B-SOL_USDT', 'decision_missing');
    expect(result.kind).toBe('NOT_FOUND');
  });

  it('returns LOOKUP_FAILED on venue errors — NEVER NOT_FOUND (old bug)', async () => {
    const client = makeClient();
    client.futures.trading.listOrders.mockRejectedValue(new Error('HTTP 503'));
    const broker = new CoinDCXExecutionBroker(client);
    const result = await broker.lookupOrder('B-SOL_USDT', 'decision_x');
    expect(result.kind).toBe('LOOKUP_FAILED');
    if (result.kind === 'LOOKUP_FAILED') expect(result.reason).toContain('HTTP 503');
  });

  it('getInstrument propagates failures instead of degrading to a fallback spec', async () => {
    const client = makeClient();
    client.futures.market.getInstrumentDetails.mockRejectedValue(new Error('rate limited'));
    const broker = new CoinDCXExecutionBroker(client);
    await expect(broker.getInstrument('B-SOL_USDT')).rejects.toThrow('rate limited');
  });
});

describe('CoinDCXExecutionBroker — FX with TTL + execution-quality guard', () => {
  it('caches the FX rate within the fresh window and re-fetches after', async () => {
    vi.useFakeTimers();
    try {
      const client = makeClient();
      const fx = vi.fn().mockResolvedValue(88);
      const broker = new CoinDCXExecutionBroker(client, {
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
      const broker = new CoinDCXExecutionBroker(client, {
        fxProvider: fx, fxFreshMs: 1_000, fxStaleMs: 2_000,
      });
      await expect(broker.convertPrice('B-SOL_INR', 100)).rejects.toThrow('tickers down');
      vi.advanceTimersByTime(60_000);
      await expect(broker.convertPrice('B-SOL_INR', 100)).rejects.toThrow(/cache expired/);
    } finally {
      vi.useRealTimers();
    }
  });

  it('converts a guarded market order into a marketable IOC limit at the worst tolerated price', async () => {
    const client = makeClient();
    const broker = new CoinDCXExecutionBroker(client);
    await broker.placeOrder({
      intentId: 'decision_sl', pair: 'B-SOL_USDT', side: 'buy',
      orderType: 'market_order', quantity: 1, leverage: 2,
      marginType: 'isolated', expectedPrice: 100, maxSlippageBps: 25,
    });
    const call = client.futures.trading.createOrder.mock.calls[0][0];
    expect(call.order_type).toBe('limit_order');
    expect(call.time_in_force).toBe('ioc');
    // worst buy price = 100 * (1 + 25/10000) = 100.25
    expect(call.price).toBeCloseTo(100.25, 6);
  });

  it('passes plain market orders through unchanged', async () => {
    const client = makeClient();
    const broker = new CoinDCXExecutionBroker(client);
    await broker.placeOrder({
      intentId: 'decision_plain', pair: 'B-SOL_USDT', side: 'sell',
      orderType: 'market_order', quantity: 1, leverage: 2, marginType: 'isolated',
    });
    const call = client.futures.trading.createOrder.mock.calls[0][0];
    expect(call.order_type).toBe('market_order');
    expect(call.time_in_force).toBe('ioc');
    expect(call.price).toBeUndefined();
  });
});
