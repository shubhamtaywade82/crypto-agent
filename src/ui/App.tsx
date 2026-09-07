import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Box, Text, useApp, useInput } from 'ink';
import { marked, Renderer } from 'marked';
import TerminalRenderer from 'marked-terminal';
import type { AgentHooks } from '@nemesis-oss/ollama-sdk';
import { runTradingAgent } from '../agent.js';
import { binanceRateLimiter } from '../guardians/rate-limiter.js';
import { defaultModel } from '../config.js';
import { WatchOrchestrator } from '../engine/orchestrator.js';
import { buildScanPrompt } from '../engine/scanner.js';
import { WatcherPanel } from './WatcherPanel.js';
import { PromptHistory, usePromptHistoryNavigation } from './history.js';
import { getKernel } from '../kernel.js';
import { deriveCircuitState, type CircuitState } from '../domain/risk/risk-config.js';
import type { PortfolioState } from '../domain/portfolio/portfolio-state.js';

const termR = new TerminalRenderer({ showSectionPrefix: false, tab: 2 }) as unknown as InstanceType<
  typeof Renderer
> & { text: (tok: unknown) => string; parser: { parseInline: (t: unknown) => string }; o: { text: (t: unknown) => string } };

termR.text = function (tok: unknown): string {
  if (tok && typeof tok === 'object' && 'tokens' in tok && tok.tokens) return this.parser.parseInline(tok.tokens);
  return this.o.text(typeof tok === 'object' && tok && 'text' in tok ? (tok as { text: unknown }).text : tok);
};
termR.hr = (): string => `\n${'─'.repeat(Math.max(20, (process.stdout.columns || 80) - 4))}\n\n`;
marked.setOptions({ renderer: termR as unknown as InstanceType<typeof Renderer> });
export const renderMarkdown = (t: string): string => {
  try { return t ? (marked.parse(t) as string).trim() : ''; } catch { return t; }
};

export const formatToolArgs = (args: unknown): string => {
  if (!args || (typeof args === 'object' && Object.keys(args).length === 0)) return '';
  const s = (typeof args === 'string' ? args : JSON.stringify(args)).replace(/\s+/g, ' ').trim();
  return s.length > 50 ? `${s.slice(0, 47)}...` : s;
};

export const formatToolResult = (raw: string): string => {
  const flat = raw.replace(/\s+/g, ' ').trim();
  try {
    const p = JSON.parse(raw) as unknown;
    if (Array.isArray(p)) return `[${p.length} items]`;
    if (p && typeof p === 'object') {
      if ('error' in p) return `Error: ${String((p as Record<string, unknown>).error)}`;
      const c = JSON.stringify(p);
      return c.length > 70 ? `${c.slice(0, 67)}...` : c;
    }
  } catch { /* fallback */ }
  return flat.length > 70 ? `${flat.slice(0, 67)}...` : flat;
};

export const formatThoughtPreview = (text: string): string => {
  const tr = text.trim();
  const f = (tr.split('\n')[0] ?? '').replace(/\s+/g, ' ');
  return `▸ 🧠 Thought: ${f.length > 60 ? `${f.slice(0, 57)}...` : f} (${tr.split('\n').filter(Boolean).length} lines)`;
};

export interface ToolEntry { id?: string; name: string; args: unknown; result?: string; }
export interface ThoughtStep { type: 'thought'; content: string; }
export interface ToolStep { type: 'tool'; tool: ToolEntry; }
export type AgentStep = ThoughtStep | ToolStep;
interface ChatMessage { id: string; role: 'user' | 'agent' | 'system'; content: string; steps?: AgentStep[]; }
interface TurnCollector { steps: AgentStep[]; }
interface AgentChatState {
  readonly messages: readonly ChatMessage[]; readonly isBusy: boolean; readonly status: string;
  readonly steps: readonly AgentStep[]; readonly response: string;
  sendMessage: (text: string) => Promise<void>; clearMessages: () => void; addSystemNote: (msg: string) => void;
}

const SPINNER = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'] as const;
const useSpinner = (active: boolean): string => {
  const [frame, setFrame] = useState(0);
  useEffect(() => {
    if (!active) return undefined;
    const timer = setInterval(() => setFrame((f) => (f + 1) % SPINNER.length), 80);
    return (): void => clearInterval(timer);
  }, [active]);
  return SPINNER[frame] ?? '⠋';
};

const circuitColor = (c: CircuitState): string =>
  c === 'NORMAL' ? 'green' : c === 'CAUTION' ? 'yellow' : c === 'REDUCED' ? 'magenta' : 'red';

const Header = ({ collapsed, port }: { collapsed: boolean; port: PortfolioState }): React.JSX.Element => {
  const kernel = getKernel();
  const c = deriveCircuitState(port.dailyLossPercent, port.drawdownPercent, port.lossStreak, kernel.limits);
  return (
    <Box flexDirection="column" borderStyle="round" borderColor="cyan" paddingX={1} marginBottom={1}>
      <Text bold color="cyan">🤖 Crypto Agent — Autonomous Trading Terminal</Text>
      <Box gap={2}>
        <Text color="gray">Venue: <Text bold color={kernel.venue === 'paper' ? 'green' : 'yellow'}>{kernel.venue.toUpperCase()}</Text></Text>
        <Text color="gray">Equity: <Text bold color="white">${port.equity.toFixed(2)}</Text></Text>
        <Text color="gray">Avail: <Text color="white">${port.availableMargin.toFixed(2)}</Text></Text>
        <Text color="gray">Daily: <Text color={port.dailyRealizedPnl >= 0 ? 'green' : 'red'}>{port.dailyRealizedPnl >= 0 ? '+' : ''}${port.dailyRealizedPnl.toFixed(2)}</Text></Text>
        <Text color="gray">Circuit: <Text bold color={circuitColor(c)}>{c} {c === 'NORMAL' ? '🟢' : '⚠️'}</Text></Text>
      </Box>
      <Box gap={2}>
        <Text color="gray">Model: <Text color="yellow">{defaultModel}</Text></Text>
        <Text color="gray">Thoughts: <Text color="magenta">{collapsed ? '▸ Collapsed' : '▾ Expanded'} [Ctrl+T]</Text></Text>
        <Text color="gray">Rate: <Text color="magenta">{binanceRateLimiter.getCurrentWeight()}/1200</Text></Text>
        <Text color="gray">Cmds: <Text color="cyan">/scan · /portfolio · /clear</Text></Text>
      </Box>
    </Box>
  );
};

const StepList = ({ steps, keyPrefix, collapsed }: { steps: readonly AgentStep[]; keyPrefix: string; collapsed?: boolean }): React.JSX.Element => (
  <Box flexDirection="column">
    {steps.map((s, idx) => s.type === 'tool' ? (
      <Text key={`${keyPrefix}-${idx}`} color="green">
        🛠️ {s.tool.name}({formatToolArgs(s.tool.args)}) {s.tool.result ? `→ ${s.tool.result}` : '...'}
      </Text>
    ) : collapsed ? (
      <Text key={`${keyPrefix}-${idx}`} color="gray" italic>{formatThoughtPreview(s.content)}</Text>
    ) : (
      <Box key={`${keyPrefix}-${idx}`} marginY={1} paddingLeft={1} borderStyle="single" borderLeft borderColor="gray">
        <Text color="gray" italic>🧠 {s.content.trim()}</Text>
      </Box>
    ))}
  </Box>
);

const MessageHistory = ({ messages, collapsed }: { messages: readonly ChatMessage[]; collapsed: boolean }): React.JSX.Element => (
  <Box flexDirection="column">
    {messages.map((m) => (
      <Box key={m.id} flexDirection="column" marginBottom={1}>
        {m.role === 'user' ? (
          <Text bold color="blue">👤 You: {m.content}</Text>
        ) : m.role === 'system' ? (
          <Text color="yellow">{renderMarkdown(m.content)}</Text>
        ) : (
          <Box flexDirection="column">
            {m.steps && <StepList steps={m.steps} keyPrefix={`msg-${m.id}`} collapsed={collapsed} />}
            <Box flexDirection="column" marginTop={1}>
              <Text bold color="cyan">💬 Agent:</Text>
              <Text>{renderMarkdown(m.content)}</Text>
            </Box>
          </Box>
        )}
      </Box>
    ))}
  </Box>
);

const LiveTurn = ({ busy, status, steps, response, collapsed }: {
  busy: boolean; status: string; steps: readonly AgentStep[]; response: string; collapsed: boolean;
}): React.JSX.Element => {
  const spinner = useSpinner(busy);
  if (!busy) return <Box />;
  return (
    <Box flexDirection="column" marginY={1}>
      <Text color="yellow">{spinner} {status}</Text>
      <StepList steps={steps} keyPrefix="live" collapsed={collapsed} />
      {response.length > 0 && (
        <Box flexDirection="column" marginTop={1}>
          <Text bold color="cyan">💬 Agent:</Text>
          <Text>{renderMarkdown(response)}</Text>
        </Box>
      )}
    </Box>
  );
};

const PromptInput = (props: {
  value: string; busy: boolean; onSubmit: () => void; onChange: (val: string) => void;
  onToggleCollapse: () => void; onHistoryUp?: () => void; onHistoryDown?: () => void;
}): React.JSX.Element => {
  const { exit } = useApp();
  useInput((input, key) => {
    if (key.ctrl && (input === 'c' || input === '\u0003')) exit();
    else if (key.ctrl && (input === 't' || input === '\u0014')) props.onToggleCollapse();
    else if (props.busy) return;
    else if (key.upArrow) props.onHistoryUp?.();
    else if (key.downArrow) props.onHistoryDown?.();
    else if (key.return) props.onSubmit();
    else if (key.backspace || key.delete) props.onChange(props.value.slice(0, -1));
    else if (!key.ctrl && !key.meta && input) props.onChange(props.value + input);
  });
  return (
    <Box borderStyle="single" borderColor={props.busy ? 'gray' : 'green'} paddingX={1}>
      <Text bold color={props.busy ? 'gray' : 'green'}>&gt; </Text>
      <Text>{props.value}</Text>
      {!props.busy && <Text color="green">█</Text>}
    </Box>
  );
};

const createLiveHooks = (handlers: {
  collector: TurnCollector; setStatus: (s: string) => void;
  setSteps: React.Dispatch<React.SetStateAction<AgentStep[]>>; setResponse: React.Dispatch<React.SetStateAction<string>>;
}): AgentHooks => ({
  onThinking: (chunk: string): void => {
    const last = handlers.collector.steps[handlers.collector.steps.length - 1];
    if (last?.type === 'thought') last.content += chunk;
    else handlers.collector.steps.push({ type: 'thought', content: chunk });
    handlers.setStatus('Reasoning...');
    handlers.setSteps([...handlers.collector.steps]);
  },
  onToolCallStart: (call): void => {
    handlers.collector.steps.push({ type: 'tool', tool: { id: call.id, name: call.function.name, args: call.function.arguments } });
    handlers.setStatus(`Calling ${call.function.name}...`);
    handlers.setSteps([...handlers.collector.steps]);
  },
  onToolCallEnd: (res): void => {
    const s = handlers.collector.steps.slice().reverse().find(
      (x) => x.type === 'tool' && (res.toolCallId ? x.tool.id === res.toolCallId : x.tool.name === res.toolName && !x.tool.result)
    );
    if (s?.type === 'tool') s.tool.result = formatToolResult(res.outputString);
    handlers.setSteps([...handlers.collector.steps]);
  },
  onToken: (token: string): void => {
    handlers.setStatus('Responding...');
    handlers.setResponse((prev) => prev + token);
  },
});

const MAX_CHAT_MESSAGES = 15;

const useAgentChat = (orchestrator: WatchOrchestrator): AgentChatState => {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isBusy, setIsBusy] = useState(false);
  const [status, setStatus] = useState('Idle');
  const [steps, setSteps] = useState<AgentStep[]>([]);
  const [response, setResponse] = useState('');

  const sendMessage = useCallback(async (text: string): Promise<void> => {
    const collector: TurnCollector = { steps: [] };
    setIsBusy(true); setStatus('Thinking with ReAct...'); setSteps([]); setResponse('');
    setMessages((prev) => [...prev, { id: String(Date.now()), role: 'user' as const, content: text }].slice(-MAX_CHAT_MESSAGES));
    const hooks = createLiveHooks({ collector, setStatus, setSteps, setResponse });
    const answer = await runTradingAgent(text, { hooks, orchestrator });
    setMessages((prev) => [...prev, { id: String(Date.now()), role: 'agent' as const, content: answer, steps: [...collector.steps] }].slice(-MAX_CHAT_MESSAGES));
    setSteps([]); setResponse(''); setIsBusy(false); setStatus('Idle');
  }, [orchestrator]);

  const clearMessages = useCallback((): void => setMessages([]), []);
  const addSystemNote = useCallback((msg: string): void => {
    setMessages((prev) => [...prev, { id: String(Date.now()), role: 'system' as const, content: msg }].slice(-MAX_CHAT_MESSAGES));
  }, []);

  return { messages, isBusy, status, steps, response, sendMessage, clearMessages, addSystemNote };
};

const usePortfolio = (orchestrator: WatchOrchestrator): PortfolioState => {
  const [port, setPort] = useState<PortfolioState>(() => getKernel().portfolio.peek());
  useEffect(() => {
    orchestrator.start();
    const poll = setInterval(async () => {
      try { setPort(await getKernel().portfolio.refresh()); } catch { /* ignore */ }
    }, 1000);
    return (): void => { clearInterval(poll); orchestrator.stop(); };
  }, [orchestrator]);
  return port;
};

interface SubmitContext {
  readonly inputVal: string; readonly setInputVal: (v: string) => void;
  readonly chat: AgentChatState; readonly history: PromptHistory; readonly exit: () => void;
}

const useSubmitHandler = (ctx: SubmitContext): () => void =>
  useCallback((): void => {
    const t = ctx.inputVal.trim();
    if (!t) return;
    if (t.toLowerCase() === 'exit' || t.toLowerCase() === 'quit') { ctx.exit(); return; }
    ctx.history.save(t);
    ctx.setInputVal('');
    if (t === '/clear') { ctx.chat.clearMessages(); return; }
    if (t === '/help') {
      ctx.chat.addSystemNote('💡 **Commands:** `/scan` · `/portfolio` · `/clear` · `[Ctrl+T]` thoughts · `exit`');
      return;
    }
    const prompt = t === '/scan' ? buildScanPrompt() : t === '/portfolio'
      ? 'Inspect portfolio state: show equity, margin, positions, and circuit risk status.' : t;
    void ctx.chat.sendMessage(prompt);
  }, [ctx]);

export const App = (): React.JSX.Element => {
  const { exit } = useApp();
  const [collapsed, setCollapsed] = useState(true);
  const orchestrator = useMemo(() => new WatchOrchestrator(), []);
  const history = useMemo(() => new PromptHistory(), []);
  const { inputVal, setInputVal, handleUp, handleDown } = usePromptHistoryNavigation(history);
  const chat = useAgentChat(orchestrator);
  const port = usePortfolio(orchestrator);
  const handleSubmit = useSubmitHandler({ inputVal, setInputVal, chat, history, exit });

  return (
    <Box flexDirection="column" padding={1}>
      <Header collapsed={collapsed} port={port} />
      <MessageHistory messages={chat.messages} collapsed={collapsed} />
      <LiveTurn busy={chat.isBusy} status={chat.status} steps={chat.steps} response={chat.response} collapsed={collapsed} />
      <WatcherPanel orchestrator={orchestrator} />
      <PromptInput
        value={inputVal} busy={chat.isBusy} onSubmit={handleSubmit} onChange={setInputVal}
        onToggleCollapse={(): void => setCollapsed((c) => !c)} onHistoryUp={handleUp} onHistoryDown={handleDown}
      />
    </Box>
  );
};
