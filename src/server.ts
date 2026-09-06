import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { runTradingAgent } from './agent.js';
import { binanceClient } from './config.js';

export const app = new Hono();

app.get('/health', (c) => c.json({ status: 'ok', timestamp: Date.now() }));

app.get('/metrics', (c) =>
  c.json({
    uptimeSeconds: Math.floor(process.uptime()),
    memoryUsageMb: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
    timestamp: Date.now(),
  })
);

app.get('/api/klines', async (c) => {
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

app.post('/api/chat', async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { prompt?: string };
  const prompt = body.prompt ?? 'Summarize current BTC market';
  const answer = await runTradingAgent(prompt);
  return c.json({ answer, timestamp: Date.now() });
});

app.get('/api/chat/stream', (c) => {
  const prompt = c.req.query('prompt') ?? 'Summarize current BTC market';
  return streamSSE(c, async (stream) => {
    await stream.writeSSE({ event: 'start', data: 'Agent processing with ReAct...' });
    const answer = await runTradingAgent(prompt);
    await stream.writeSSE({ event: 'token', data: answer });
    await stream.writeSSE({ event: 'done', data: 'Completed' });
  });
});

const DASHBOARD_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"><title>Crypto Agent Dashboard</title>
  <script src="https://unpkg.com/lightweight-charts/dist/lightweight-charts.standalone.production.js"></script>
  <style>
    body { margin:0; background:#121212; color:#eee; font-family:sans-serif; display:flex; height:100vh; }
    #chart-panel { flex:1; display:flex; flex-direction:column; padding:10px; }
    #chart { flex:1; }
    #chat-panel { width:420px; background:#1e1e1e; display:flex; flex-direction:column; border-left:1px solid #333; }
    #messages { flex:1; overflow-y:auto; padding:15px; font-size:14px; line-height:1.5; }
    .msg { margin-bottom:12px; padding:8px 12px; border-radius:6px; }
    .user { background:#2a3b4c; align-self:flex-end; }
    .agent { background:#2e2e2e; }
    #input-box { display:flex; padding:10px; border-top:1px solid #333; }
    input { flex:1; background:#292929; border:1px solid #444; color:#fff; padding:8px; border-radius:4px; }
    button { background:#00c087; color:#fff; border:none; padding:8px 16px; margin-left:8px; border-radius:4px; cursor:pointer; }
  </style>
</head>
<body>
  <div id="chart-panel">
    <h2>Crypto Agent — Realtime Market & ReAct Analysis</h2>
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
    const chart = LightweightCharts.createChart(document.getElementById('chart'), {
      layout: { background: { color: '#121212' }, textColor: '#ccc' },
      grid: { vertLines: { color: '#222' }, horzLines: { color: '#222' } }
    });
    const candleSeries = chart.addCandlestickSeries();
    fetch('/api/klines?symbol=BTCUSDT')
      .then(r => r.json())
      .then(data => candleSeries.setData(data.candles));

    async function sendPrompt(e) {
      e.preventDefault();
      const inp = document.getElementById('prompt');
      const text = inp.value.trim();
      if (!text) return;
      appendMsg('user', text);
      inp.value = '';
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: text })
      });
      const data = await res.json();
      appendMsg('agent', data.answer);
    }
    function appendMsg(role, text) {
      const el = document.createElement('div');
      el.className = 'msg ' + role;
      el.innerText = (role === 'user' ? '👤 You: ' : '🤖 Agent: ') + text;
      document.getElementById('messages').appendChild(el);
    }
  </script>
</body>
</html>`;

app.get('/', (c) => c.html(DASHBOARD_HTML));

const port = Number(process.env.PORT ?? 3001);
// Standalone boot when file is run directly via CLI
if (process.argv[1] && process.argv[1].endsWith('server.ts')) {
  process.stdout.write(`🚀 Crypto Agent Hono server listening on http://localhost:${port}\n`);
  serve({ fetch: app.fetch, port });
}
