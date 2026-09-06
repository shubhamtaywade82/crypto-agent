import { describe, expect, it, vi } from 'vitest';
import type { BinanceClient } from '@nemesis-oss/binance-sdk';
import {
  createBalanceTool,
  createKlinesTool,
  createPlaceOrderTool,
  createPositionSizeTool,
  createPriceTool,
  createTradingRegistry,
} from '../src/tools.js';

describe('Crypto Trading Tools with BinanceClient & Decimal Precision', () => {
  const mockBinance = {
    spot: {
      market: {
        ticker24hr: vi.fn().mockResolvedValue({
          lastPrice: '65000.00',
          priceChangePercent: '2.50',
          quoteVolume: '1000000.00',
        }),
        klines: vi.fn().mockResolvedValue([
          {
            open: '64000.00',
            high: '65500.00',
            low: '63900.00',
            close: '65000.00',
            volume: '120.5',
            openTime: 1725638400000,
          },
        ]),
      },
      account: {
        account: vi.fn().mockResolvedValue({
          balances: [
            { asset: 'USDT', free: '5000.00', locked: '0.00' },
            { asset: 'BTC', free: '0.50', locked: '0.10' },
            { asset: 'ETH', free: '0.00', locked: '0.00' },
          ],
        }),
      },
      trading: {
        createOrder: vi.fn().mockResolvedValue({
          orderId: 987654321,
          symbol: 'BTCUSDT',
          side: 'BUY',
          price: '60000.00',
          origQty: '0.05',
          status: 'NEW',
        }),
      },
    },
  } as unknown as BinanceClient;

  it('fetches 24h ticker price and volume', async () => {
    const priceTool = createPriceTool(mockBinance);
    const result = await priceTool.execute({ symbol: 'BTCUSDT' }, {});
    expect(result).toMatchObject({
      symbol: 'BTCUSDT',
      price: '65000.00',
      change24h: '2.50',
    });
  });

  it('fetches klines preserving UTC milliseconds integer timestamp', async () => {
    const klinesTool = createKlinesTool(mockBinance);
    const result = (await klinesTool.execute(
      { symbol: 'BTCUSDT', interval: '1h', limit: 1 },
      {}
    )) as Array<{ openTime: number }>;

    expect(result).toHaveLength(1);
    expect(typeof result[0]!.openTime).toBe('number');
    expect(result[0]!.openTime).toBe(1725638400000);
  });

  it('filters out zero-balance assets using Decimal comparison', async () => {
    const balanceTool = createBalanceTool(mockBinance);
    const result = (await balanceTool.execute({}, {})) as Array<{ asset: string }>;

    expect(result).toHaveLength(2);
    expect(result.map((b) => b.asset)).toEqual(['USDT', 'BTC']);
  });

  it('calculates position size with strict Decimal rounding and division guards', async () => {
    const posTool = createPositionSizeTool();
    const result = (await posTool.execute(
      {
        accountBalance: '10000',
        riskPercent: '1',
        entryPrice: '50000',
        stopLossPrice: '49000',
      },
      {}
    )) as { riskAmount: string; quantity: string; notional: string };

    expect(result.riskAmount).toBe('100.00');
    expect(result.quantity).toBe('0.1000');
    expect(result.notional).toBe('5000.00');

    await expect(
      posTool.execute(
        {
          accountBalance: '10000',
          riskPercent: '1',
          entryPrice: '50000',
          stopLossPrice: '50000',
        },
        {}
      )
    ).rejects.toThrow(/identical/);
  });

  it('enforces safety notional cap on order placement', async () => {
    const orderTool = createPlaceOrderTool(mockBinance);
    await expect(
      orderTool.execute(
        {
          symbol: 'BTCUSDT',
          side: 'BUY',
          quantity: '1.0',
          price: '65000',
        },
        {}
      )
    ).rejects.toThrow(/safety cap/);
  });

  it('places limit order and returns string orderId', async () => {
    const orderTool = createPlaceOrderTool(mockBinance);
    const result = (await orderTool.execute(
      {
        symbol: 'BTCUSDT',
        side: 'BUY',
        quantity: '0.05',
        price: '60000',
      },
      {}
    )) as { orderId: string; status: string };

    expect(result.orderId).toBe('987654321');
    expect(typeof result.orderId).toBe('string');
    expect(result.status).toBe('NEW');
  });

  it('creates registry with all tools and timeout configuration', () => {
    const registry = createTradingRegistry(mockBinance);
    const defs = registry.definitions();
    expect(defs).toHaveLength(5);
    expect(defs.map((d) => d.function.name)).toContain('get_price');
    expect(defs.map((d) => d.function.name)).toContain('place_limit_order');
  });
});
