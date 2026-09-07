import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Box, Static, Text, useApp, useInput } from 'ink';
import { marked, Renderer } from 'marked';
import TerminalRenderer from 'marked-terminal';
import type { AgentHooks } from '@nemesis-oss/ollama-sdk';
import { runTradingAgent } from '../agent.js';
import { binanceRateLimiter } from '../guardians/rate-limiter.js';
import { defaultModel } from '../config.js';
import { WatchOrchestrator } from '../engine/orchestrator.js';
import { WatcherPanel } from './WatcherPanel.js';
import { PromptHistory, usePromptHistoryNavigation } from './history.js';
import { getKernel, type TradingKernel } from '../kernel.js';
const DEFAULT_SYMBOLS = (process.env.KERNEL_SYMBOLS ?? 'BTCUSDT,SOLUSDT').split(',').map((s) => s.trim().toUpperCase());
import { deriveCircuitState, type CircuitState } from '../domain/risk/risk-config.js';
import type { PortfolioState } from '../domain/portfolio/portfolio-state.js';

const termR = new TerminalRenderer({ showSectionPrefix: false, tab: 2 }) as unknown as InstanceType<typeof Renderer> & {
  text: (tok: unknown) => string; parser: { parseInline: (t: unknown) => string }; o: { text: (t: unknown) => string };
};
termR.text = function (t: unknown): string {
  const tok = t && typeof t === 'object' && 'tokens' in t && (t as { tokens: unknown }).tokens;
  return tok ? this.parser.parseInline(tok) : this.o.text(typeof t === 'object' && t && 'text' in t ? (t as { text: unknown }).text : t);
};
termR.hr = (): string => `\n${'─'.repeat(Math.max(20, (process.stdout.columns || 80) - 4))}\n\n`;
marked.setOptions({ renderer: termR as unknown as InstanceType<typeof Renderer> });
export const renderMarkdown = (t: string): string => { try { return t ? (marked.parse(t) as string).trim() : ''; } catch { return t; } };
export const formatToolArgs = (a: unknown): string => {
  const s = (!a || (typeof a === 'object' && Object.keys(a).length === 0)) ? '' : (typeof a === 'string' ? a : JSON.stringify(a)).replace(/\s+/g, ' ').trim();
  return s.length > 50 ? `${s.slice(0, 47)}...` : s;
};
export const formatToolResult = (raw: string): string => {
  try {
    const p = JSON.parse(raw) as Record<string, unknown>;
    if (Array.isArray(p)) return `[${p.length} items]`;
    const c = p?.error ? `Error: ${String(p.error)}` : JSON.stringify(p);
    return c.length > 70 ? `${c.slice(0, 67)}...` : c;
  } catch {
    const flat = raw.replace(/\s+/g, ' ').trim();
    return flat.length > 70 ? `${flat.slice(0, 67)}...` : flat;
  }
};
export const formatThoughtPreview = (text: string): string => {
  const lines = text.trim().split('\n').filter(Boolean);
  const f = (lines[0] ?? '').replace(/\s+/g, ' ');
  return `▸ 🧠 Thought: ${f.length > 60 ? `${f.slice(0, 57)}...` : f} (${lines.length} lines)`;
};
export interface ToolEntry { id?: string; name: string; args: unknown; result?: string; }
export interface ThoughtStep { type: 'thought'; content: string; }
export interface ToolStep { type: 'tool'; tool: ToolEntry; }
export type AgentStep = ThoughtStep | ToolStep;
export interface TurnOptions { prompt: string; title?: string; role?: 'user' | 'agent' | 'system' | 'trigger'; statusText?: string; }
interface ChatMessage { id: string; role: 'user' | 'agent' | 'system' | 'trigger'; title?: string; content: string; steps?: AgentStep[]; }
interface TurnCollector { steps: AgentStep[]; }
interface AgentChatState {
  readonly messages: readonly ChatMessage[]; readonly isBusy: boolean; readonly status: string;
  readonly steps: readonly AgentStep[]; readonly response: string;
  runTurn: (opts: TurnOptions) => Promise<string>; runPipelineTrace: (sym: string) => Promise<void>;
  runKernelScan: (syms?: readonly string[]) => Promise<void>;
  clearMessages: () => void; addSystemNote: (msg: string) => void;
}
const SPINNER = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'] as const;
const useSpinner = (active: boolean): string => {
  const [frame, setFrame] = useState(0);
  useEffect(() => {
    if (!active) return undefined;
    const t = setInterval(() => setFrame((f) => (f + 1) % SPINNER.length), 80);
    return (): void => clearInterval(t);
  }, [active]);
  return SPINNER[frame] ?? '⠋';
};
const circuitColor = (c: CircuitState): string =>
  c === 'NORMAL' ? 'green' : c === 'CAUTION' ? 'yellow' : c === 'REDUCED' ? 'magenta' : 'red';

const Header = ({ collapsed, port, auto }: {
  collapsed: boolean; port: PortfolioState; auto: { enabled: boolean; interval: number };
}): React.JSX.Element => {
  const kernel = getKernel();
  const c = deriveCircuitState(port.dailyLossPercent, port.drawdownPercent, port.lossStreak, kernel.limits);
  const pnl = `${port.dailyRealizedPnl >= 0 ? '+' : ''}$${port.dailyRealizedPnl.toFixed(2)}`;
  const autoTxt = auto.enabled ? `🟢 ON (${Math.round(auto.interval / 60)}m)` : '⚪ OFF';
  return (
    <Box flexDirection="column">
      <Box justifyContent="space-between">
        <Text bold color="cyan">🤖 Crypto Agent <Text color="gray">({kernel.venue.toUpperCase()})</Text></Text>
        <Text color="gray" wrap="truncate">Auto: <Text bold color={auto.enabled ? 'green' : 'gray'}>{autoTxt}</Text> │ Circuit: <Text bold color={circuitColor(c)}>{c} {c === 'NORMAL' ? '🟢' : '⚠️'}</Text> │ Rate: <Text color="magenta">{binanceRateLimiter.getCurrentWeight()}/1200</Text></Text>
      </Box>
      <Text color="gray" wrap="truncate">Equity: <Text bold color="white">${port.equity.toFixed(2)}</Text> │ Avail: <Text color="white">${port.availableMargin.toFixed(2)}</Text> │ Daily: <Text color={port.dailyRealizedPnl >= 0 ? 'green' : 'red'}>{pnl}</Text> │ Model: <Text color="yellow">{defaultModel}</Text> │ <Text color="magenta">{collapsed ? '▸ [Ctrl+T]' : '▾ [Ctrl+T]'}</Text></Text>
    </Box>
  );
};

const StepList = ({ steps, keyPrefix, collapsed }: { steps: readonly AgentStep[]; keyPrefix: string; collapsed?: boolean }): React.JSX.Element => (
  <Box flexDirection="column">
    {steps.map((s, idx) => s.type === 'tool' ? (
      <Text key={`${keyPrefix}-${idx}`} color="green">🛠️ {s.tool.name}({formatToolArgs(s.tool.args)}) {s.tool.result ? `→ ${s.tool.result}` : '...'}</Text>
    ) : collapsed ? (
      <Text key={`${keyPrefix}-${idx}`} color="gray" italic>{formatThoughtPreview(s.content)}</Text>
    ) : (
      <Box key={`${keyPrefix}-${idx}`} marginY={1} paddingLeft={1} borderStyle="single" borderLeft borderColor="gray"><Text color="gray" italic>🧠 {s.content.trim()}</Text></Box>
    ))}
  </Box>
);

const RenderChatMessage = ({ m, collapsed }: { m: ChatMessage; collapsed: boolean }): React.JSX.Element => (
  <Box key={m.id} flexDirection="column" marginY={1}>
    {m.title ? <Text bold color="cyan">{m.title}</Text> : m.role === 'user' ? <Text bold color="blue">👤 You: {m.content}</Text> : m.role === 'system' ? <Text color="yellow">{renderMarkdown(m.content)}</Text> : null}
    <Box flexDirection="column">
      {m.steps && <StepList steps={m.steps} keyPrefix={`msg-${m.id}`} collapsed={collapsed} />}
      {m.content && m.role !== 'system' && <Box flexDirection="column" marginTop={1}><Text bold color="cyan">💬 Agent:</Text><Text>{renderMarkdown(m.content)}</Text></Box>}
      {m.title && m.role === 'system' && <Text>{renderMarkdown(m.content)}</Text>}
    </Box>
  </Box>
);

const LiveTurn = ({ busy, status, steps, response, collapsed }: {
  busy: boolean; status: string; steps: readonly AgentStep[]; response: string; collapsed: boolean;
}): React.JSX.Element => !busy ? <Box /> : (
  <Box flexDirection="column" marginY={1}>
    <Text color="yellow">{useSpinner(busy)} {status}</Text>
    <StepList steps={steps} keyPrefix="live" collapsed={collapsed} />
    {response.length > 0 && <Box flexDirection="column" marginTop={1}><Text bold color="cyan">💬 Agent:</Text><Text>{renderMarkdown(response)}</Text></Box>}
  </Box>
);

const PromptInput = (p: {
  value: string; busy: boolean; onSubmit: () => void; onChange: (v: string) => void;
  onToggleCollapse: () => void; onHistoryUp?: () => void; onHistoryDown?: () => void;
}): React.JSX.Element => {
  const { exit } = useApp();
  useInput((input, key) => {
    if (key.ctrl && (input === 'c' || input === '\u0003')) exit();
    else if (key.ctrl && (input === 't' || input === '\u0014')) p.onToggleCollapse();
    else if (!p.busy && key.upArrow) p.onHistoryUp?.();
    else if (!p.busy && key.downArrow) p.onHistoryDown?.();
    else if (!p.busy && key.return) p.onSubmit();
    else if (!p.busy && (key.backspace || key.delete)) p.onChange(p.value.slice(0, -1));
    else if (!p.busy && !key.ctrl && !key.meta && input) p.onChange(p.value + input);
  });
  return <Box><Text bold color={p.busy ? 'gray' : 'green'}>&gt; </Text><Text>{p.value}</Text>{!p.busy && <Text color="green">█</Text>}</Box>;
};
const createLiveHooks = (handlers: {
  collector: TurnCollector; setStatus: (s: string) => void;
  setSteps: React.Dispatch<React.SetStateAction<AgentStep[]>>; setResponse: React.Dispatch<React.SetStateAction<string>>;
}): AgentHooks => {
  const sync = (): void => handlers.setSteps([...handlers.collector.steps]);
  return {
    onThinking: (chunk: string): void => {
      const last = handlers.collector.steps[handlers.collector.steps.length - 1];
      if (last?.type === 'thought') last.content += chunk;
      else handlers.collector.steps.push({ type: 'thought', content: chunk });
      handlers.setStatus('Reasoning...'); sync();
    },
    onToolCallStart: (c): void => {
      handlers.collector.steps.push({ type: 'tool', tool: { id: c.id, name: c.function.name, args: c.function.arguments } });
      handlers.setStatus(`Calling ${c.function.name}...`); sync();
    },
    onToolCallEnd: (res): void => {
      const s = handlers.collector.steps.slice().reverse().find(
        (x) => x.type === 'tool' && (res.toolCallId ? x.tool.id === res.toolCallId : x.tool.name === res.toolName && !x.tool.result)
      );
      if (s?.type === 'tool') s.tool.result = formatToolResult(res.outputString);
      sync();
    },
    onToken: (t: string): void => { handlers.setStatus('Responding...'); handlers.setResponse((p) => p + t); },
  };
};
const formatPipelineTrace = (symbol: string, trace: Awaited<ReturnType<TradingKernel['runPipeline']>>): string => {
  const setups = trace.setups.length ? trace.setups.map((s) => `${s.type} (RR: ${s.rr.toFixed(2)})`).join(', ') : 'None';
  const sizing = trace.sizing ? `${trace.sizing.quantity} qty ($${trace.sizing.notional.toFixed(2)}, ${trace.sizing.leverage.toFixed(1)}x)` : 'N/A';
  const analyst = trace.analysis ? `${trace.analysis.bias}: ${trace.analysis.summary.slice(0, 80)}` : 'N/A';
  return `### Multi-Agent Kernel Trace: ${symbol}\n- **Status**: \`${trace.status}\` · **Regime**: \`${trace.regime}\`\n- **Setups**: ${setups}\n- **Analyst**: ${analyst}\n- **Strategist**: \`${trace.outcome?.action ?? 'N/A'}\` (Conf: ${trace.outcome?.confidence ?? 0})\n- **Challenger**: \`${trace.challenge?.verdict ?? 'N/A'}\`\n- **Sizing**: ${sizing}\n- **Order**: ${trace.order?.status ?? 'None'}`;
};

const usePipelineTrace = (
  setBusy: (b: boolean) => void, setStatus: (s: string) => void, addMsg: (m: ChatMessage) => void
): { runPipelineTrace: (sym: string) => Promise<void>; runKernelScan: (syms?: readonly string[]) => Promise<void> } => {
  const runPipelineTrace = useCallback(async (symbol: string): Promise<void> => {
    setBusy(true); setStatus(`Running kernel pipeline for ${symbol}...`);
    try {
      const trace = await getKernel().runPipeline(symbol);
      const time = new Date().toLocaleTimeString('en-IN', { hour12: false });
      addMsg({ id: String(Date.now()), role: 'system', title: `🛡️ [KERNEL PIPELINE: ${symbol} — ${time}]`, content: formatPipelineTrace(symbol, trace) });
    } catch (err) {
      addMsg({ id: String(Date.now()), role: 'system', content: `⚠️ Pipeline error: ${err instanceof Error ? err.message : String(err)}` });
    } finally {
      setBusy(false); setStatus('Idle');
    }
  }, [setBusy, setStatus, addMsg]);

  const runKernelScan = useCallback(async (symbols?: readonly string[]): Promise<void> => {
    const list = symbols && symbols.length > 0 ? symbols : DEFAULT_SYMBOLS;
    for (const sym of list) await runPipelineTrace(sym);
  }, [runPipelineTrace]);

  return { runPipelineTrace, runKernelScan };
};
const useTriggerListener = (orchestrator: WatchOrchestrator, runPipeline: (sym: string) => Promise<void>): void => {
  useEffect(() => {
    orchestrator.setAgentRunner(async (_prompt, event) => { await runPipeline(event.condition.symbol); return ''; });
    return (): void => orchestrator.setAgentRunner(undefined);
  }, [orchestrator, runPipeline]);
};
const MAX_CHAT_MESSAGES = 15;
const useAgentChat = (orchestrator: WatchOrchestrator): AgentChatState => {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isBusy, setIsBusy] = useState(false);
  const [status, setStatus] = useState('Idle');
  const [steps, setSteps] = useState<AgentStep[]>([]);
  const [response, setResponse] = useState('');

  const appendMsg = useCallback((m: ChatMessage): void => setMessages((p) => [...p, m].slice(-MAX_CHAT_MESSAGES)), []);
  const clearMessages = useCallback((): void => setMessages([]), []);
  const addSystemNote = useCallback((msg: string): void => appendMsg({ id: String(Date.now()), role: 'system', content: msg }), [appendMsg]);

  const runTurn = useCallback(async (opts: TurnOptions): Promise<string> => {
    const collector: TurnCollector = { steps: [] };
    setIsBusy(true); setStatus(opts.statusText ?? 'Thinking with ReAct...'); setSteps([]); setResponse('');
    if (opts.role === 'user') appendMsg({ id: String(Date.now()), role: 'user', content: opts.prompt });
    const hooks = createLiveHooks({ collector, setStatus, setSteps, setResponse });
    const answer = await runTradingAgent(opts.prompt, { hooks, orchestrator });
    appendMsg({ id: String(Date.now()), role: opts.role ?? 'agent', title: opts.title, content: answer, steps: [...collector.steps] });
    setSteps([]); setResponse(''); setIsBusy(false); setStatus('Idle');
    return answer;
  }, [orchestrator, appendMsg]);

  const { runPipelineTrace, runKernelScan } = usePipelineTrace(setIsBusy, setStatus, appendMsg);
  useTriggerListener(orchestrator, runPipelineTrace);
  return { messages, isBusy, status, steps, response, runTurn, runPipelineTrace, runKernelScan, clearMessages, addSystemNote };
};

const usePortfolio = (orchestrator: WatchOrchestrator): PortfolioState => {
  const [port, setPort] = useState<PortfolioState>(() => getKernel().portfolio.peek());
  useEffect(() => {
    orchestrator.start();
    const poll = setInterval(() => { void getKernel().portfolio.refresh().then(setPort).catch(() => {}); }, 1000);
    return (): void => { clearInterval(poll); orchestrator.stop(); };
  }, [orchestrator]);
  return port;
};
interface SubmitContext {
  readonly inputVal: string; readonly setInputVal: (v: string) => void;
  readonly chat: AgentChatState; readonly history: PromptHistory; readonly exit: () => void;
  readonly setAuto: React.Dispatch<React.SetStateAction<{ enabled: boolean; interval: number }>>;
}
const handleAutoCommand = (arg: string | undefined, ctx: SubmitContext): void => {
  if (arg === 'off') { ctx.setAuto((p) => ({ ...p, enabled: false })); ctx.chat.addSystemNote('⚪ Auto-Pilot disabled.'); return; }
  if (arg === 'on') { ctx.setAuto((p) => ({ ...p, enabled: true })); ctx.chat.addSystemNote('🟢 Auto-Pilot enabled (5m interval).'); return; }
  const s = arg ? (arg.endsWith('m') ? parseInt(arg, 10) * 60 : parseInt(arg, 10)) : NaN;
  if (!isNaN(s) && s >= 10) { ctx.setAuto({ enabled: true, interval: s }); ctx.chat.addSystemNote(`🟢 Auto-Pilot enabled (${s}s).`); return; }
  ctx.setAuto((p) => { ctx.chat.addSystemNote(!p.enabled ? '🟢 Auto-Pilot enabled.' : '⚪ Auto-Pilot disabled.'); return { ...p, enabled: !p.enabled }; });
};
const useSubmitHandler = (ctx: SubmitContext): () => void =>
  useCallback((): void => {
    const t = ctx.inputVal.trim();
    if (!t) return;
    if (t.toLowerCase() === 'exit' || t.toLowerCase() === 'quit') { ctx.exit(); return; }
    ctx.history.save(t); ctx.setInputVal('');
    if (t === '/clear') { process.stdout.write('\x1b[2J\x1b[3J\x1b[H'); ctx.chat.clearMessages(); return; }
    if (t === '/help') { ctx.chat.addSystemNote('💡 `/scan [sym]` · `/auto [on|off|<interval>]` · `/pipeline <sym>` · `/portfolio` · `/clear` · `[Ctrl+T]` · `exit`'); return; }
    if (t.startsWith('/auto')) { handleAutoCommand(t.split(/\s+/)[1]?.toLowerCase(), ctx); return; }
    const pSym = t.startsWith('/pipeline') ? t.split(/\s+/)[1]?.toUpperCase() || 'BTCUSDT' : t.startsWith('/scan ') ? t.slice(6).trim().toUpperCase() : null;
    if (pSym) { void ctx.chat.runPipelineTrace(pSym); return; }
    if (t === '/scan') { void ctx.chat.runKernelScan(); return; }
    const prompt = t === '/portfolio' ? 'Inspect portfolio state: show equity, margin, positions, and circuit risk status.' : t;
    void ctx.chat.runTurn({ prompt, role: 'user' });
  }, [ctx]);

export const App = (): React.JSX.Element => {
  const { exit } = useApp();
  const [collapsed, setCollapsed] = useState(true);
  const [auto, setAuto] = useState({ enabled: true, interval: 300 });
  const orchestrator = useMemo(() => new WatchOrchestrator(), []);
  const history = useMemo(() => new PromptHistory(), []);
  const { inputVal, setInputVal, handleUp, handleDown } = usePromptHistoryNavigation(history);
  const chat = useAgentChat(orchestrator);
  const port = usePortfolio(orchestrator);
  const handleSubmit = useSubmitHandler({ inputVal, setInputVal, chat, history, exit, setAuto });
  useEffect(() => {
    if (!auto.enabled) return undefined;
    const timer = setInterval(() => {
      if (!chat.isBusy) void chat.runKernelScan();
    }, auto.interval * 1000);
    return (): void => clearInterval(timer);
  }, [auto.enabled, auto.interval, chat]);
  return (
    <Box flexDirection="column" paddingX={1}>
      <Static items={chat.messages as ChatMessage[]}>{(m) => <RenderChatMessage key={m.id} m={m} collapsed={collapsed} />}</Static>
      <LiveTurn busy={chat.isBusy} status={chat.status} steps={chat.steps} response={chat.response} collapsed={collapsed} />
      <Box flexDirection="column" borderStyle="round" borderColor="cyan" paddingX={1} marginTop={1}>
        <Header collapsed={collapsed} port={port} auto={auto} />
        <Text color="gray">{'─'.repeat(Math.max(20, (process.stdout.columns || 80) - 6))}</Text>
        <WatcherPanel orchestrator={orchestrator} />
        <Text color="gray">{'─'.repeat(Math.max(20, (process.stdout.columns || 80) - 6))}</Text>
        <PromptInput value={inputVal} busy={chat.isBusy} onSubmit={handleSubmit} onChange={setInputVal} onToggleCollapse={(): void => setCollapsed((c) => !c)} onHistoryUp={handleUp} onHistoryDown={handleDown} />
      </Box>
    </Box>
  );
};
