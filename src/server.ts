import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import type { AgentHooks } from '@nemesis-oss/ollama-sdk';
import { runTradingAgent } from './agent.js';
import { binanceClient } from './config.js';
import { getKernel } from './kernel.js';
import { buildMarketState } from './engines/market-state-engine.js';
import { ApiAuthenticator, auditCaller } from './security/auth.js';
import type { AuthVariables } from './security/auth.js';
import type { Capability } from './security/capabilities.js';
import { analyticsSnapshot } from './learning/performance-analytics.js';
import { runWalkForwardFromProvider } from './learning/walk-forward.js';
import { loadRiskLimits } from './domain/risk/risk-config.js';
import { DASHBOARD_HTML } from './ui/dashboard.js';

export const app = new Hono<AuthVariables>();

const auth = new ApiAuthenticator();

/** Probe routes stay unauthenticated (load-balancer health checks). */
app.get('/health', (c) => c.json({ status: 'ok', timestamp: Date.now() }));

app.get('/metrics', (c) =>
  c.json({
    uptimeSeconds: Math.floor(process.uptime()),
    memoryUsageMb: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
    timestamp: Date.now(),
  })
);

/** Fail-closed gate: when no keys are configured, kernel API is disabled. */
const guard = (required: Capability): ReturnType<ApiAuthenticator['middleware']> =>
  auth.middleware(required);

// ---- Kernel v3 endpoints (capability-scoped; see src/security) ----

app.get('/api/kernel/state/:symbol', guard('READ_MARKET'), async (c) => {
  const kernel = getKernel();
  const symbol = c.req.param('symbol')?.toUpperCase() ?? 'BTCUSDT';
  const mtf = await buildMarketState(kernel.provider, symbol);
  return c.json(mtf.state);
});

app.get('/api/kernel/portfolio', guard('READ_PORTFOLIO'), async (c) => {
  const kernel = getKernel();
  return c.json(await kernel.portfolio.refresh());
});

app.get('/api/kernel/events', guard('READ_AUDIT'), (c) => {
  const kernel = getKernel();
  const limit = Number(c.req.query('limit') ?? 50);
  return c.json({ events: kernel.store.readAll(limit) });
});

app.post('/api/kernel/pipeline/:symbol', guard('RUN_PIPELINE'), async (c) => {
  const kernel = getKernel();
  const symbol = c.req.param('symbol')?.toUpperCase() ?? 'BTCUSDT';
  auditCaller(kernel.store, c.get('caller'), 'pipeline.run', { symbol });
  const trace = await kernel.lanes.enqueue(symbol, () => kernel.runPipeline(symbol));
  return c.json(trace);
});

app.get('/api/kernel/orders', guard('READ_AUDIT'), (c) => {
  const kernel = getKernel();
  return c.json({ orders: kernel.execution.listOpen() });
});

app.get('/api/kernel/killswitch', guard('READ_AUDIT'), (c) => {
  const kernel = getKernel();
  return c.json({
    state: kernel.killSwitch.state,
    reason: kernel.killSwitch.currentReason,
    actor: kernel.killSwitch.lastActor,
    changedAt: kernel.killSwitch.lastChangedAt,
  });
});

app.get('/api/kernel/analytics', guard('READ_PORTFOLIO'), (c) => {
  const kernel = getKernel();
  const snapshot = analyticsSnapshot(kernel.ledger.outcomes);
  const strategies = kernel.strategies.all().map((s) => ({
    strategyId: s.strategyId,
    version: s.version,
    status: s.status,
    promotedAt: s.promotedAt ?? null,
    retiredAt: s.retiredAt ?? null,
    gate: s.gate,
  }));
  return c.json({
    ...snapshot,
    openTrades: kernel.ledger.openTrades.length,
    strategies,
    execution: kernel.fills.quality(),
  });
});

app.get('/api/kernel/streams', guard('READ_MARKET'), (c) => {
  const kernel = getKernel();
  return c.json({
    market: kernel.streams.market?.status() ?? null,
    account: kernel.streams.account?.status() ?? null,
    marketStalenessMs: kernel.marketStore.stalenessMs('BTCUSDT') ?? null,
    accountStalenessMs: kernel.accountCache.stalenessMs() ?? null,
  });
});

app.post('/api/kernel/walkforward/:symbol', guard('ADMIN'), async (c) => {
  const kernel = getKernel();
  const symbol = c.req.param('symbol')?.toUpperCase() ?? 'BTCUSDT';
  auditCaller(kernel.store, c.get('caller'), 'walkforward.run', { symbol });
  const result = await runWalkForwardFromProvider(kernel.provider, symbol, loadRiskLimits());
  return c.json({
    symbol,
    trades: result.trades.length,
    totalR: Number(result.totalR.toFixed(3)),
    cells: result.cells,
    verdicts: result.verdicts.map((v) => ({
      cell: v.cell, promoted: v.promoted, reasons: v.reasons,
      n: v.stats.n, expectancyR: Number(v.stats.expectancyR.toFixed(3)),
    })),
  });
});

app.post('/api/kernel/killswitch/halt', guard('CONTROL_TRADE'), async (c) => {
  const kernel = getKernel();
  const body = (await c.req.json().catch(() => ({}))) as { reason?: string };
  const caller = c.get('caller');
  const reason = body.reason ?? 'halted via API';
  kernel.killSwitch.halt(reason, caller.keyId);
  auditCaller(kernel.store, caller, 'killswitch.halt', { reason });
  return c.json({ state: kernel.killSwitch.state, reason });
});

app.post('/api/kernel/killswitch/resume', guard('ADMIN'), async (c) => {
  const kernel = getKernel();
  const body = (await c.req.json().catch(() => ({}))) as { reason?: string };
  const caller = c.get('caller');
  try {
    kernel.killSwitch.resume(body.reason ?? '', caller.keyId);
    auditCaller(kernel.store, caller, 'killswitch.resume', { reason: body.reason });
    return c.json({ state: kernel.killSwitch.state });
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : String(err) }, 400);
  }
});

app.get('/api/klines', guard('READ_MARKET'), async (c) => {
  const symbol = (c.req.query('symbol') ?? 'BTCUSDT').toUpperCase();
  const rawKlines = await binanceClient.spot.market.klines(symbol, '1h', { limit: 60 });
  // Map Binance klines to Lightweight Charts { time, open, high, low, close }
  const candles = rawKlines.map((k) => ({
    time: Math.floor(k.openTime / 1000),
    open: Number(k.open),
    high: Number(k.high),
    low: Number(k.low),
    close: Number(k.close),
  }));
  return c.json({ symbol, candles });
});

app.post('/api/chat', guard('CREATE_INTENT'), async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { prompt?: string };
  const prompt = body.prompt ?? 'Summarize current BTC market';
  const answer = await runTradingAgent(prompt);
  return c.json({ answer, timestamp: Date.now() });
});

type SSEStream = Parameters<Parameters<typeof streamSSE>[1]>[0];

const createStreamHooks = (stream: SSEStream, onTokenSeen: () => void): AgentHooks => ({
  onThinking: async (chunk): Promise<void> => {
    await stream.writeSSE({ event: 'thinking', data: JSON.stringify({ type: 'thinking', content: chunk }) });
  },
  onToolCallStart: async (call): Promise<void> => {
    await stream.writeSSE({
      event: 'tool_call',
      data: JSON.stringify({ type: 'tool_call', name: call.function.name, args: call.function.arguments }),
    });
  },
  onToolCallEnd: async (res): Promise<void> => {
    const result = res.success ? res.result : res.error.message;
    await stream.writeSSE({
      event: 'tool_result',
      data: JSON.stringify({ type: 'tool_result', name: res.toolName, result }),
    });
  },
  onTurnEnd: async (turn): Promise<void> => {
    if (turn.message.thinking) {
      await stream.writeSSE({
        event: 'thinking',
        data: JSON.stringify({ type: 'thinking', content: turn.message.thinking }),
      });
    }
  },
  onToken: async (token): Promise<void> => {
    onTokenSeen();
    await stream.writeSSE({ event: 'token', data: JSON.stringify({ type: 'token', content: token }) });
  },
});

app.get('/api/chat/stream', guard('CREATE_INTENT'), (c) => {
  const prompt = c.req.query('prompt') ?? 'Summarize current BTC market';
  return streamSSE(c, async (stream) => {
    let hasStreamedToken = false;
    await stream.writeSSE({ event: 'start', data: JSON.stringify({ type: 'start' }) });
    const hooks = createStreamHooks(stream, () => {
      hasStreamedToken = true;
    });
    const answer = await runTradingAgent(prompt, { hooks });

    if (!hasStreamedToken && answer) {
      await stream.writeSSE({ event: 'token', data: JSON.stringify({ type: 'token', content: answer }) });
    }

    await stream.writeSSE({ event: 'done', data: JSON.stringify({ type: 'done' }) });
  });
});



app.get('/', (c) => {
  c.header('Cache-Control', 'no-store, no-cache, must-revalidate');
  return c.html(DASHBOARD_HTML);
});

const port = Number(process.env.PORT ?? 3002);
// Standalone boot when file is run directly via CLI (not imported in tests)
const isDirectExecution =
  Boolean(process.argv[1]) &&
  !process.argv[1].includes('vitest') &&
  (process.argv[1].endsWith('server.ts') || process.argv[1].endsWith('server.js'));

if (isDirectExecution) {
  process.stdout.write(`🚀 Crypto Agent Hono server listening on http://localhost:${port}\n`);
  serve({ fetch: app.fetch, port });
}
