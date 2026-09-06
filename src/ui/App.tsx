import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Box, Text, useApp, useInput } from 'ink';
import { marked, Renderer } from 'marked';
import TerminalRenderer from 'marked-terminal';
import type { AgentHooks } from '@nemesis-oss/ollama-sdk';
import { runTradingAgent } from '../agent.js';
import { binanceRateLimiter } from '../guardians/rate-limiter.js';
import { defaultModel } from '../config.js';
import { WatchOrchestrator } from '../engine/orchestrator.js';
import { WatcherPanel } from './WatcherPanel.js';

const terminalRenderer = new TerminalRenderer({ showSectionPrefix: false, tab: 2 }) as unknown as InstanceType<
  typeof Renderer
> & { text: (token: unknown) => string; parser: { parseInline: (t: unknown) => string }; o: { text: (t: unknown) => string } };

// marked-terminal misses inner tokens on text tokens in marked v15 tight lists
terminalRenderer.text = function (tok: unknown): string {
  if (tok && typeof tok === 'object' && 'tokens' in tok && tok.tokens) return this.parser.parseInline(tok.tokens);
  return this.o.text(typeof tok === 'object' && tok && 'text' in tok ? (tok as { text: unknown }).text : tok);
};

// Override hr to prevent 1-character wrap in Ink's padded container
terminalRenderer.hr = (): string => {
  const cols = process.stdout.columns || 80;
  return `\n${'─'.repeat(Math.max(20, cols - 4))}\n\n`;
};

marked.setOptions({ renderer: terminalRenderer as unknown as InstanceType<typeof Renderer> });

export const renderMarkdown = (text: string): string => {
  if (!text) return '';
  try {
    return (marked.parse(text) as string).trim();
  } catch {
    return text;
  }
};

export const formatToolArgs = (args: unknown): string => {
  if (!args || (typeof args === 'object' && Object.keys(args).length === 0)) return '';
  const str = typeof args === 'string' ? args : JSON.stringify(args);
  const flattened = str.replace(/\s+/g, ' ').trim();
  return flattened.length > 50 ? `${flattened.slice(0, 47)}...` : flattened;
};

export const formatToolResult = (raw: string): string => {
  const flat = raw.replace(/\s+/g, ' ').trim();
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed)) return `[${parsed.length} items]`;
    if (parsed && typeof parsed === 'object') {
      if ('error' in parsed) return `Error: ${String((parsed as Record<string, unknown>).error)}`;
      const compact = JSON.stringify(parsed);
      return compact.length > 70 ? `${compact.slice(0, 67)}...` : compact;
    }
  } catch { /* fallback to flat string */ }
  return flat.length > 70 ? `${flat.slice(0, 67)}...` : flat;
};

export const formatThoughtPreview = (text: string): string => {
  const trimmed = text.trim();
  const first = (trimmed.split('\n')[0] ?? '').replace(/\s+/g, ' ');
  const count = trimmed.split('\n').filter(Boolean).length;
  const preview = first.length > 60 ? `${first.slice(0, 57)}...` : first;
  return `▸ 🧠 Thought: ${preview} (${count} lines)`;
};

export interface ToolEntry { id?: string; name: string; args: unknown; result?: string; }
export interface ThoughtStep { type: 'thought'; content: string; }
export interface ToolStep { type: 'tool'; tool: ToolEntry; }
export type AgentStep = ThoughtStep | ToolStep;
interface ChatMessage { id: string; role: 'user' | 'agent'; content: string; steps?: AgentStep[]; }
interface TurnCollector { steps: AgentStep[]; }

interface ChatHandlers {
  collector: TurnCollector; setStatus: (s: string) => void;
  setSteps: React.Dispatch<React.SetStateAction<AgentStep[]>>; setResponse: React.Dispatch<React.SetStateAction<string>>;
}

interface AgentChatState {
  messages: ChatMessage[]; isBusy: boolean; status: string;
  steps: AgentStep[]; response: string; sendMessage: (prompt: string) => Promise<void>;
}

interface LiveTurnProps {
  busy: boolean; status: string; steps: AgentStep[]; response: string; collapsed: boolean;
}

interface InputProps {
  value: string; busy: boolean; onSubmit: () => void; onChange: (val: string) => void; onToggleCollapse: () => void;
}

const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'] as const;

const useSpinner = (active: boolean): string => {
  const [frame, setFrame] = useState(0);
  useEffect(() => {
    if (!active) return undefined;
    const timer = setInterval(() => setFrame((f) => (f + 1) % SPINNER_FRAMES.length), 80);
    return (): void => clearInterval(timer);
  }, [active]);
  return SPINNER_FRAMES[frame] ?? '⠋';
};

const Header = ({ collapsed }: { collapsed: boolean }): React.JSX.Element => (
  <Box flexDirection="column" borderStyle="round" borderColor="cyan" paddingX={1} marginBottom={1}>
    <Text bold color="cyan">🤖 Crypto Agent — Autonomous ReAct Trading Terminal</Text>
    <Box gap={2}>
      <Text color="gray">Model: <Text color="yellow">{defaultModel}</Text></Text>
      <Text color="gray">Env: <Text color="green">paper-broker</Text></Text>
      <Text color="gray">Thoughts: <Text color="magenta">{collapsed ? '▸ Collapsed' : '▾ Expanded'} [Ctrl+T]</Text></Text>
      <Text color="gray">Rate Limit: <Text color="magenta">{binanceRateLimiter.getCurrentWeight()}/1200</Text></Text>
    </Box>
  </Box>
);

const StepList = ({ steps, keyPrefix, collapsed }: { steps: AgentStep[]; keyPrefix: string; collapsed?: boolean }): React.JSX.Element => (
  <Box flexDirection="column">
    {steps.map((s, idx) => {
      if (s.type === 'tool') {
        return (
          <Text key={`${keyPrefix}-${idx}`} color="green">
            🛠️ {s.tool.name}({formatToolArgs(s.tool.args)}) {s.tool.result ? `→ ${s.tool.result}` : '...'}
          </Text>
        );
      }
      if (collapsed) {
        return <Text key={`${keyPrefix}-${idx}`} color="gray" italic>{formatThoughtPreview(s.content)}</Text>;
      }
      return (
        <Box key={`${keyPrefix}-${idx}`} marginY={1} paddingLeft={1} borderStyle="single" borderLeft borderColor="gray">
          <Text color="gray" italic>🧠 {s.content.trim()}</Text>
        </Box>
      );
    })}
  </Box>
);

const MessageHistory = ({ messages, collapsed }: { messages: ChatMessage[]; collapsed: boolean }): React.JSX.Element => (
  <Box flexDirection="column">
    {messages.map((m) => (
      <Box key={m.id} flexDirection="column" marginBottom={1}>
        {m.role === 'user' ? (
          <Text bold color="blue">👤 You: {m.content}</Text>
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

const LiveTurn = ({ busy, status, steps, response, collapsed }: LiveTurnProps): React.JSX.Element => {
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

const PromptInput = ({ value, busy, onSubmit, onChange, onToggleCollapse }: InputProps): React.JSX.Element => {
  const { exit } = useApp();
  useInput((input, key) => {
    if (key.ctrl && (input === 'c' || input === '\u0003')) exit();
    else if (key.ctrl && (input === 't' || input === '\u0014')) onToggleCollapse();
    else if (busy) return;
    else if (key.return) onSubmit();
    else if (key.backspace || key.delete) onChange(value.slice(0, -1));
    else if (!key.ctrl && !key.meta && input) onChange(value + input);
  });
  return (
    <Box borderStyle="single" borderColor={busy ? 'gray' : 'green'} paddingX={1}>
      <Text bold color={busy ? 'gray' : 'green'}>💬 You &gt; </Text>
      <Text>{value}</Text>
      {!busy && <Text color="green">█</Text>}
    </Box>
  );
};

const recordThought = (collector: TurnCollector, chunk: string): void => {
  const last = collector.steps[collector.steps.length - 1];
  if (last?.type === 'thought') last.content += chunk;
  else collector.steps.push({ type: 'thought', content: chunk });
};

const recordToolResult = (
  collector: TurnCollector,
  res: { toolCallId?: string; toolName: string; outputString: string }
): void => {
  const formatted = formatToolResult(res.outputString);
  for (let i = collector.steps.length - 1; i >= 0; i--) {
    const s = collector.steps[i];
    if (s?.type === 'tool' && (res.toolCallId ? s.tool.id === res.toolCallId : s.tool.name === res.toolName && !s.tool.result)) {
      s.tool.result = formatted;
      break;
    }
  }
};

const createLiveHooks = (handlers: ChatHandlers): AgentHooks => ({
  onThinking: (chunk: string): void => {
    recordThought(handlers.collector, chunk);
    handlers.setStatus('Reasoning...');
    handlers.setSteps([...handlers.collector.steps]);
  },
  onToolCallStart: (call): void => {
    handlers.collector.steps.push({ type: 'tool', tool: { id: call.id, name: call.function.name, args: call.function.arguments } });
    handlers.setStatus(`Calling ${call.function.name}...`);
    handlers.setSteps([...handlers.collector.steps]);
  },
  onToolCallEnd: (res): void => {
    recordToolResult(handlers.collector, res);
    handlers.setSteps([...handlers.collector.steps]);
  },
  onToken: (token: string): void => {
    handlers.setStatus('Responding...');
    handlers.setResponse((prev) => prev + token);
  },
});

const useAgentChat = (orchestrator: WatchOrchestrator): AgentChatState => {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isBusy, setIsBusy] = useState(false);
  const [status, setStatus] = useState('Idle');
  const [steps, setSteps] = useState<AgentStep[]>([]);
  const [response, setResponse] = useState('');

  const sendMessage = useCallback(async (text: string): Promise<void> => {
    const collector: TurnCollector = { steps: [] };
    setIsBusy(true);
    setStatus('Thinking with ReAct...');
    setSteps([]);
    setResponse('');
    setMessages((prev) => [...prev, { id: String(Date.now()), role: 'user', content: text }]);
    const hooks = createLiveHooks({ collector, setStatus, setSteps, setResponse });
    const answer = await runTradingAgent(text, { hooks, orchestrator });
    setMessages((prev) => [...prev, { id: String(Date.now()), role: 'agent', content: answer, steps: [...collector.steps] }]);
    setSteps([]);
    setResponse('');
    setIsBusy(false);
    setStatus('Idle');
  }, [orchestrator]);

  return { messages, isBusy, status, steps, response, sendMessage };
};

export const App = (): React.JSX.Element => {
  const { exit } = useApp();
  const [inputVal, setInputVal] = useState('');
  const [collapsed, setCollapsed] = useState(true);
  const orchestrator = useMemo(() => new WatchOrchestrator(), []);
  const chat = useAgentChat(orchestrator);

  useEffect(() => {
    orchestrator.start();
    return (): void => orchestrator.stop();
  }, [orchestrator]);

  const handleSubmit = useCallback((): void => {
    const trimmed = inputVal.trim();
    if (!trimmed) return;
    if (trimmed.toLowerCase() === 'exit' || trimmed.toLowerCase() === 'quit') { exit(); return; }
    setInputVal('');
    void chat.sendMessage(trimmed);
  }, [inputVal, chat, exit]);

  return (
    <Box flexDirection="column" padding={1}>
      <Header collapsed={collapsed} />
      <WatcherPanel orchestrator={orchestrator} />
      <MessageHistory messages={chat.messages} collapsed={collapsed} />
      <LiveTurn busy={chat.isBusy} status={chat.status} steps={chat.steps} response={chat.response} collapsed={collapsed} />
      <PromptInput
        value={inputVal}
        busy={chat.isBusy}
        onSubmit={handleSubmit}
        onChange={setInputVal}
        onToggleCollapse={(): void => setCollapsed((c) => !c)}
      />
    </Box>
  );
};
