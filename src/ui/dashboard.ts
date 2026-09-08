/** Embedded dashboard UI (kept out of the server file for lint hygiene). */
export const DASHBOARD_HTML = `<!DOCTYPE html>
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
