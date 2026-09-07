import { describe, expect, it, vi } from 'vitest';
import type { BinanceClient, ToolDefinition as BinanceToolDefinition } from '@nemesis-oss/binance-sdk';
import { z } from 'zod';
import {
  adaptBinanceTool,
  createPositionSizeTool,
  createTradingRegistry,
} from '../src/tools.js';

describe('Tool Adapter & Trading Registry with Built-in Binance Tools', () => {
  const mockTool: BinanceToolDefinition = {
    name: 'mock_ping',
    description: 'Ping test',
    inputSchema: z.object({ symbol: z.string() }),
    handler: async ({ symbol }) => ({ status: 'pong', symbol }),
  };

  it('adapts a Binance SDK tool to an Ollama AnyTool', async () => {
    const adapted = adaptBinanceTool(mockTool, { env: 'testnet', isSigned: false });
    expect(adapted.name).toBe('mock_ping');
    expect(adapted.description).toBe('Ping test');

    const result = await adapted.execute({ symbol: 'BTCUSDT' }, {});
    expect(result).toEqual({ status: 'pong', symbol: 'BTCUSDT' });
  });

  it('calculates position size with strict Decimal precision and input validation', async () => {
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

  it('creates registry with selected spot tools and position size tool', () => {
    const mockBinance = {
      spot: {
        market: {
          ping: vi.fn(),
          tickerPrice: vi.fn(),
          ticker24hr: vi.fn(),
          serverTime: vi.fn(),
          exchangeInfo: vi.fn(),
          bookTicker: vi.fn(),
          depth: vi.fn(),
          trades: vi.fn(),
          klines: vi.fn(),
          avgPrice: vi.fn(),
        },
        account: {
          account: vi.fn(),
        },
        trading: {
          createOrder: vi.fn(),
          cancelOrder: vi.fn(),
          getOpenOrders: vi.fn(),
        },
      },
    } as unknown as BinanceClient;

    const registry = createTradingRegistry(mockBinance, ['spot_ticker_price', 'spot_klines']);
    const defs = registry.definitions();

    // 2 spot tools + calculate_position_size + 2 paper-broker tools = 5
    expect(defs).toHaveLength(5);
    const names = defs.map((d) => d.function.name);
    expect(names).toContain('spot_ticker_price');
    expect(names).toContain('spot_klines');
    expect(names).toContain('calculate_position_size');
    expect(names).toContain('paper_broker_place_order');
    expect(names).toContain('paper_broker_get_positions');
  });

  it('includes watch and journal tools when orchestrator is passed', () => {
    const mockBinance = { spot: { market: {}, account: {}, trading: {} } } as unknown as BinanceClient;
    const mockOrchestrator = {
      addWatch: vi.fn(),
      getStatuses: vi.fn().mockReturnValue([]),
      removeWatch: vi.fn(),
      journal: {
        logSetup: vi.fn(),
        closeTrade: vi.fn(),
        getTrades: vi.fn().mockReturnValue([]),
        getStats: vi.fn().mockReturnValue({}),
        getRecentLessons: vi.fn().mockReturnValue([]),
        findActiveTrade: vi.fn(),
      },
    };

    const registry = createTradingRegistry(mockBinance, [], mockOrchestrator as never);
    const names = registry.definitions().map((d) => d.function.name);

    expect(names).toContain('register_price_watch');
    expect(names).toContain('list_active_watches');
    expect(names).toContain('remove_price_watch');
    expect(names).toContain('log_trade_setup');
    expect(names).toContain('record_trade_outcome');
    expect(names).toContain('get_trade_journal');
    expect(names).toContain('get_learned_rules');
  });
});
