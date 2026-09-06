import { describe, expect, it, vi } from 'vitest';
import { app } from '../src/server.js';

vi.mock('../src/agent.js', () => ({
  runTradingAgent: vi.fn().mockResolvedValue('BTC is in an uptrend with strong volume.'),
}));

vi.mock('../src/config.js', () => ({
  defaultModel: 'gemma4:cloud',
  ollamaClient: {},
  binanceClient: {
    spot: {
      market: {
        klines: vi.fn().mockResolvedValue([
          {
            openTime: 1725638400000,
            open: '65000',
            high: '65500',
            low: '64900',
            close: '65400',
          },
        ]),
      },
    },
  },
}));

describe('Hono Server API & Streaming Endpoints', () => {
  it('GET /health returns status ok', async () => {
    const res = await app.request('/health');
    expect(res.status).toBe(200);
    const data = (await res.json()) as { status: string };
    expect(data.status).toBe('ok');
  });

  it('GET /api/klines returns lightweight-charts formatted candles', async () => {
    const res = await app.request('/api/klines?symbol=BTCUSDT');
    expect(res.status).toBe(200);
    const data = (await res.json()) as { symbol: string; candles: Array<{ open: number }> };
    expect(data.symbol).toBe('BTCUSDT');
    expect(data.candles[0]?.open).toBe(65000);
  });

  it('POST /api/chat executes agent and returns response', async () => {
    const res = await app.request('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: 'Market status' }),
    });
    expect(res.status).toBe(200);
    const data = (await res.json()) as { answer: string };
    expect(data.answer).toContain('uptrend');
  });

  it('GET / serves the dashboard HTML', async () => {
    const res = await app.request('/');
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('LightweightCharts');
    expect(html).toContain('Crypto Agent');
  });
});
