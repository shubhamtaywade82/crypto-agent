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

describe('UI Formatters & Markdown Renderer', () => {
  it('formats tool arguments into a single compact string', async () => {
    const { formatToolArgs } = await import('../src/ui/App.js');
    expect(formatToolArgs({})).toBe('');
    expect(formatToolArgs({ symbol: 'SOLUSDT' })).toBe('{"symbol":"SOLUSDT"}');
    const longArgs = { symbol: 'BTCUSDT', extra: 'a'.repeat(60) };
    expect(formatToolArgs(longArgs).length).toBeLessThanOrEqual(50);
  }, 15_000);

  it('formats tool results compactly on a single line without newlines', async () => {
    const { formatToolResult } = await import('../src/ui/App.js');
    const arrayResult = JSON.stringify([{ id: 1 }, { id: 2 }, { id: 3 }]);
    expect(formatToolResult(arrayResult)).toBe('[3 items]');

    const objResult = JSON.stringify({ symbol: 'SOLUSDT', price: '106.50' }, null, 2);
    expect(formatToolResult(objResult)).not.toContain('\n');
    expect(formatToolResult(objResult)).toContain('SOLUSDT');

    const errResult = JSON.stringify({ error: 'Rate limit exceeded' });
    expect(formatToolResult(errResult)).toBe('Error: Rate limit exceeded');
  });

  it('renders markdown tables, horizontal rules, and styled text with terminal formatting', async () => {
    const { renderMarkdown } = await import('../src/ui/App.js');
    const md = '# Title\n\n| Col A | Col B |\n|---|---|\n| Val 1 | Val 2 |\n\n---\n\n**BoldText**';
    const rendered = renderMarkdown(md);
    expect(rendered).toContain('Title');
    expect(rendered).toContain('┌');
    expect(rendered).toContain('Val 1');
    expect(rendered).toContain('─');
    expect(rendered).not.toContain('**BoldText**');
    expect(rendered).toContain('BoldText');
  });

  it('formats collapsed thought previews with single-line summary and line count', async () => {
    const { formatThoughtPreview } = await import('../src/ui/App.js');
    const thought = 'Line 1: analyzing SOLUSDT\nLine 2: checking indicators\nLine 3: done';
    const preview = formatThoughtPreview(thought);
    expect(preview).toContain('▸ 🧠 Thought:');
    expect(preview).toContain('Line 1: analyzing SOLUSDT');
    expect(preview).toContain('(3 lines)');
  });
});
