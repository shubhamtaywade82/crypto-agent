import { describe, expect, it, vi } from 'vitest';
import { formatMarketEventAlert } from '../src/notifications/signal-telegram.js';

describe('formatMarketEventAlert', () => {
  it('includes symbol, timeframe, and event label', () => {
    const text = formatMarketEventAlert('SOLUSDT', '1h', {
      eventType: 'choch',
      eventId: 'c1',
      direction: 'bullish',
      label: 'bullish CHoCH break @ 102.10',
    });
    expect(text).toContain('SOLUSDT');
    expect(text).toContain('1h');
    expect(text).toContain('CHoCH');
  });
});

describe('Telegram dual-bot routing', () => {
  const mockFetch = vi.fn().mockResolvedValue({ ok: true });

  it('uses alert bot token for status', async () => {
    vi.stubGlobal('fetch', mockFetch);
    process.env.TELEGRAM_CHAT_ID = '99';
    process.env.TELEGRAM_ALERTBOT_BOT_TOKEN = 'alert-bot';
    process.env.TELEGRAM_TRADING_BOT_TOKEN = 'trade-bot';
    vi.resetModules();
    const { sendTelegramStatus } = await import('../src/notifications/telegram.js');
    await sendTelegramStatus('stream up');
    expect(mockFetch.mock.calls[0]?.[0]).toContain('alert-bot');
  });
});
