import { describe, expect, it, vi } from 'vitest';
import { app } from '../src/server.js';

// Runs before module imports: the authenticator parses keys at construction.
vi.hoisted(() => {
  process.env.KERNEL_API_KEYS = 'viewer-k:v-secret:viewer,trader-k:t-secret:trader';
});

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

const authHeaders = (cred: string): Record<string, string> => ({
  Authorization: `Bearer ${cred}`,
  'Content-Type': 'application/json',
});

describe('Hono Server API — security (fail-closed)', () => {
  it('unauthenticated kernel API requests fail closed with 401', async () => {
    const res = await app.request('/api/klines?symbol=BTCUSDT');
    expect(res.status).toBe(401);
    const portfolio = await app.request('/api/kernel/portfolio');
    expect(portfolio.status).toBe(401);
    const pipeline = await app.request('/api/kernel/pipeline/BTCUSDT', { method: 'POST' });
    expect(pipeline.status).toBe(401);
  });

  it('wrong secret fails closed with 401', async () => {
    const res = await app.request('/api/klines?symbol=BTCUSDT', {
      headers: authHeaders('trader-k:WRONG'),
    });
    expect(res.status).toBe(401);
  });

  it('insufficient capability fails closed with 403', async () => {
    // viewer lacks RUN_PIPELINE
    const res = await app.request('/api/kernel/pipeline/BTCUSDT', {
      method: 'POST',
      headers: authHeaders('viewer-k:v-secret'),
    });
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: string; required: string };
    expect(body.error).toBe('forbidden');
    expect(body.required).toBe('RUN_PIPELINE');
  });
});

describe('Hono Server API & Streaming Endpoints', () => {

  it('GET /health returns status ok (public probe)', async () => {
    const res = await app.request('/health');
    expect(res.status).toBe(200);
    const data = (await res.json()) as { status: string };
    expect(data.status).toBe('ok');
  });

  it('GET /metrics returns uptime and memory usage (public probe)', async () => {
    const res = await app.request('/metrics');
    expect(res.status).toBe(200);
    const data = (await res.json()) as { uptimeSeconds: number; memoryUsageMb: number };
    expect(typeof data.uptimeSeconds).toBe('number');
    expect(typeof data.memoryUsageMb).toBe('number');
  });

  it('GET /api/klines returns lightweight-charts formatted candles', async () => {
    const res = await app.request('/api/klines?symbol=BTCUSDT', {
      headers: authHeaders('viewer-k:v-secret'),
    });
    expect(res.status).toBe(200);
    const data = (await res.json()) as { symbol: string; candles: Array<{ open: number }> };
    expect(data.symbol).toBe('BTCUSDT');
    expect(data.candles[0]?.open).toBe(65000);
  });

  it('POST /api/chat executes agent and returns response', async () => {
    const res = await app.request('/api/chat', {
      method: 'POST',
      headers: authHeaders('trader-k:t-secret'),
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
