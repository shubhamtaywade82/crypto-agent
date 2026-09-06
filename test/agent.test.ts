import { describe, expect, it, vi } from 'vitest';
import type { OllamaClient } from '@nemesis-oss/ollama-sdk';
import type { BinanceClient } from '@nemesis-oss/binance-sdk';
import { runTradingAgent } from '../src/agent.js';

describe('Trading Agent Harness with Built-in Binance Tools & Agent', () => {
  const mockBinance = {
    spot: {
      market: {
        tickerPrice: vi.fn().mockResolvedValue({
          symbol: 'BTCUSDT',
          price: '80000.00',
        }),
      },
    },
  } as unknown as BinanceClient;

  it('executes adapted spot_ticker_price tool and completes ReAct turn', async () => {
    // Turn 1: model triggers spot_ticker_price
    // Turn 2: model processes response and outputs conclusion
    const mockChat = vi
      .fn()
      .mockResolvedValueOnce({
        message: {
          role: 'assistant',
          content: '',
          tool_calls: [
            {
              id: 'call_spot_ticker_1',
              function: {
                name: 'spot_ticker_price',
                arguments: { symbol: 'BTCUSDT' },
              },
            },
          ],
        },
      })
      .mockResolvedValueOnce({
        message: {
          role: 'assistant',
          content: 'Bitcoin is trading at 80000.00 USDT.',
        },
      });

    const mockOllama = { chat: mockChat } as unknown as OllamaClient;

    const answer = await runTradingAgent('What is the current BTC price?', {
      ollama: mockOllama,
      binance: mockBinance,
      model: 'gemma4:cloud',
      tools: ['spot_ticker_price'],
    });

    expect(answer).toBe('Bitcoin is trading at 80000.00 USDT.');
    expect(mockChat).toHaveBeenCalledTimes(2);
  });

  it('handles empty response gracefully with fallback string', async () => {
    const mockChat = vi.fn().mockResolvedValueOnce({
      message: {
        role: 'assistant',
        content: '',
      },
    });

    const mockOllama = { chat: mockChat } as unknown as OllamaClient;

    const answer = await runTradingAgent('Hello', {
      ollama: mockOllama,
      binance: mockBinance,
    });

    expect(answer).toBe('No response from agent.');
  });
});
