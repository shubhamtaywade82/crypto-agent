import { describe, expect, it, vi } from 'vitest';
import type { OllamaClient } from '@nemesis-oss/ollama-sdk';
import type { BinanceClient } from '@nemesis-oss/binance-sdk';
import { runTradingAgent } from '../src/agent.js';

describe('Trading Agent Harness with Agent and ToolRegistry', () => {
  const mockBinance = {
    spot: {
      market: {
        ticker24hr: vi.fn().mockResolvedValue({
          lastPrice: '67000.00',
          priceChangePercent: '3.10',
          quoteVolume: '500000.00',
        }),
      },
    },
  } as unknown as BinanceClient;

  it('runs multi-turn tool execution and returns agent final message', async () => {
    // Turn 1: model decides to call get_price
    // Turn 2: model processes tool output and delivers final conclusion
    const mockChat = vi
      .fn()
      .mockResolvedValueOnce({
        message: {
          role: 'assistant',
          content: '',
          tool_calls: [
            {
              id: 'call_get_price_1',
              function: {
                name: 'get_price',
                arguments: { symbol: 'BTCUSDT' },
              },
            },
          ],
        },
      })
      .mockResolvedValueOnce({
        message: {
          role: 'assistant',
          content: 'BTCUSDT is at $67,000.00 (+3.10% 24h).',
        },
      });

    const mockOllama = { chat: mockChat } as unknown as OllamaClient;

    const answer = await runTradingAgent('What is BTC price?', {
      ollama: mockOllama,
      binance: mockBinance,
      model: 'gemma4:cloud',
    });

    expect(answer).toBe('BTCUSDT is at $67,000.00 (+3.10% 24h).');
    expect(mockChat).toHaveBeenCalledTimes(2);
  });

  it('handles empty response gracefully', async () => {
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
