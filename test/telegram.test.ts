import { describe, expect, it, vi } from 'vitest';

// Isolate fetch mock before importing telegram module
const mockFetch = vi.fn().mockResolvedValue({ ok: true });
vi.stubGlobal('fetch', mockFetch);

describe('Telegram Notifier', () => {
  it('sends formatted HTML alert with event data', async () => {
    process.env.TELEGRAM_BOT_TOKEN = 'test-token';
    process.env.TELEGRAM_CHAT_ID = '12345';

    const { sendTelegramAlert } = await import('../src/notifications/telegram.js');

    const event = {
      condition: {
        id: 'sol-1',
        symbol: 'SOLUSDT',
        strategy: 'Breakout Buy',
        type: 'price_above' as const,
        targetPrice: 106,
        cooldownMs: 300_000,
        createdAt: Date.now(),
        reEvaluationPrompt: 'check breakout',
      },
      currentPrice: 106.5,
      triggeredAt: Date.now(),
    };

    const result = await sendTelegramAlert(event, 'Agent confirmed breakout.');
    expect(result).toBe(true);
    expect(mockFetch).toHaveBeenCalledOnce();

    const body = JSON.parse(mockFetch.mock.calls[0]?.[1]?.body as string) as Record<string, unknown>;
    expect(body.chat_id).toBe('12345');
    expect(body.parse_mode).toBe('HTML');
    expect(body.text).toContain('SOLUSDT');
    expect(body.text).toContain('106.5');
    expect(body.text).toContain('Agent confirmed breakout.');
  });

  it('returns false when env vars are missing', async () => {
    delete process.env.TELEGRAM_BOT_TOKEN;
    delete process.env.TELEGRAM_CHAT_ID;

    vi.resetModules();
    const { sendTelegramAlert } = await import('../src/notifications/telegram.js');

    const event = {
      condition: {
        id: 'x', symbol: 'X', strategy: 'X', type: 'price_above' as const,
        targetPrice: 1, cooldownMs: 0, createdAt: 0, reEvaluationPrompt: '',
      },
      currentPrice: 1,
      triggeredAt: 0,
    };

    const result = await sendTelegramAlert(event, 'test');
    expect(result).toBe(false);
  });
});
