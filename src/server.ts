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

const DASHBOARD_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"><title>Crypto Agent Dashboard</title>
  <script src="https://unpkg.com/lightweight-charts@4.2.2/dist/lightweight-charts.standalone.production.js"></script>
  <style>
    body { margin:0; background:#121212; color:#eee; font-family:sans-serif; display:flex; height:100vh; overflow:hidden; }
    #chart-panel { flex:1; display:flex; flex-direction:column; padding:12px; min-width:0; min-height:0; }
    #chart-header { display:flex; justify-content:space-between; align-items:center; margin-bottom:8px; }
    #chart-title { margin:0; font-size:18px; color:#00c087; }
    #chart { flex:1; width:100%; min-height:0; }
    #chat-panel { width:440px; background:#1e1e1e; display:flex; flex-direction:column; border-left:1px solid #333; }
    #messages { flex:1; overflow-y:auto; padding:15px; font-size:14px; line-height:1.5; }
    .msg { margin-bottom:12px; padding:8px 12px; border-radius:6px; word-break:break-word; }
    .user { background:#2a3b4c; align-self:flex-end; }
    .agent { background:#2e2e2e; }
    .thought { color:#888; font-style:italic; font-size:12px; border-left:2px solid #555; padding-left:8px; margin:6px 0; }
    .tool-box { background:#16241b; border:1px solid #234d31; color:#7ee787; font-size:12px; font-family:monospace; padding:6px; border-radius:4px; margin:4px 0; }
    #input-box { display:flex; padding:10px; border-top:1px solid #333; }
    input { flex:1; background:#292929; border:1px solid #444; color:#fff; padding:8px; border-radius:4px; }
    button { background:#00c087; color:#fff; border:none; padding:8px 16px; margin-left:8px; border-radius:4px; cursor:pointer; }
  </style>
</head>
<body>
  <div id="chart-panel">
    <div id="chart-header">
      <h2 id="chart-title">🤖 Crypto Agent — BTCUSDT (1h)</h2>
    </div>
    <div id="chart"></div>
  </div>
  <div id="chat-panel">
    <div id="messages"></div>
    <form id="input-box" onsubmit="sendPrompt(event)">
      <input id="prompt" placeholder="Ask agent to analyze, compute size, or execute..." />
      <button type="submit">Send</button>
    </form>
  </div>
  <script>
    const el = document.getElementById('chart');
    const chart = LightweightCharts.createChart(el, {
      width: el.clientWidth,
      height: el.clientHeight,
      layout: { background: { color: '#121212' }, textColor: '#ccc' },
      grid: { vertLines: { color: '#1e1e1e' }, horzLines: { color: '#1e1e1e' } },
      timeScale: { timeVisible: true, secondsVisible: false, borderColor: '#333' },
      rightPriceScale: { borderColor: '#333' }
    });
    const candleSeries = typeof chart.addCandlestickSeries === 'function'
      ? chart.addCandlestickSeries({
          upColor: '#26a69a', downColor: '#ef5350', borderVisible: false,
          wickUpColor: '#26a69a', wickDownColor: '#ef5350'
        })
      : chart.addSeries(LightweightCharts.CandlestickSeries, {
          upColor: '#26a69a', downColor: '#ef5350', borderVisible: false,
          wickUpColor: '#26a69a', wickDownColor: '#ef5350'
        });
    fetch('/api/klines?symbol=BTCUSDT')
      .then(r => r.json())
      .then(data => {
        if (data.candles && data.candles.length) {
          candleSeries.setData(data.candles);
          chart.timeScale().fitContent();
        }
      });

    window.addEventListener('resize', () => {
      chart.applyOptions({ width: el.clientWidth, height: el.clientHeight });
    });

    function appendEl(cls, text) {
      const el = document.createElement('div');
      el.className = cls;
      el.innerText = text;
      document.getElementById('messages').appendChild(el);
      document.getElementById('messages').scrollTop = document.getElementById('messages').scrollHeight;
      return el;
    }

    function sendPrompt(e) {
      e.preventDefault();
      const inp = document.getElementById('prompt');
      const text = inp.value.trim();
      if (!text) return;
      appendEl('msg user', '👤 You: ' + text);
      inp.value = '';

      let agentBubble = null;
      let thoughtBubble = null;
      const es = new EventSource('/api/chat/stream?prompt=' + encodeURIComponent(text));

      es.addEventListener('thinking', (ev) => {
        const d = JSON.parse(ev.data);
        if (!thoughtBubble) thoughtBubble = appendEl('thought', '🧠 Thinking: ');
        thoughtBubble.innerText += d.content;
      });
      es.addEventListener('tool_call', (ev) => {
        const d = JSON.parse(ev.data);
        appendEl('tool-box', '🛠️ Calling: ' + d.name + '(' + JSON.stringify(d.args) + ')');
      });
      es.addEventListener('tool_result', (ev) => {
        const d = JSON.parse(ev.data);
        const prev = typeof d.result === 'object' ? JSON.stringify(d.result).slice(0, 100) : String(d.result).slice(0, 100);
        appendEl('tool-box', '📦 Result: ' + d.name + ' -> ' + prev + '...');
      });
      es.addEventListener('token', (ev) => {
        const d = JSON.parse(ev.data);
        if (!agentBubble) agentBubble = appendEl('msg agent', '🤖 Agent: ');
        agentBubble.innerText += d.content;
      });
      es.addEventListener('done', () => es.close());
      es.onerror = () => es.close();
    }
  </script>
</body>
</html>`;

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
