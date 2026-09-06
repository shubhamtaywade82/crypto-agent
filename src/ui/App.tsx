import React, { useCallback, useEffect, useState } from 'react';
import { Box, Text, useApp, useInput } from 'ink';
import type { AgentHooks } from '@nemesis-oss/ollama-sdk';
import { runTradingAgent } from '../agent.js';
import { binanceRateLimiter } from '../guardians/rate-limiter.js';
import { defaultModel } from '../config.js';

const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'] as const;

interface ToolEntry {
  name: string;
  args: unknown;
  result?: string;
}

interface ChatMessage {
  id: string;
  role: 'user' | 'agent';
  content: string;
  thoughts?: string;
  tools?: ToolEntry[];
}

const useSpinner = (active: boolean): string => {
  const [frame, setFrame] = useState(0);
  useEffect(() => {
    if (!active) return undefined;
    const timer = setInterval(() => setFrame((f) => (f + 1) % SPINNER_FRAMES.length), 80);
    return (): void => clearInterval(timer);
  }, [active]);
  return SPINNER_FRAMES[frame] ?? '⠋';
};

const Header = (): React.JSX.Element => {
  const weight = binanceRateLimiter.getCurrentWeight();
  return (
    <Box flexDirection="column" borderStyle="round" borderColor="cyan" paddingX={1} marginBottom={1}>
      <Text bold color="cyan">🤖 Crypto Agent — Autonomous ReAct Trading Terminal</Text>
      <Box gap={2}>
        <Text color="gray">Model: <Text color="yellow">{defaultModel}</Text></Text>
        <Text color="gray">Env: <Text color="green">paper-broker</Text></Text>
        <Text color="gray">Rate Limit: <Text color="magenta">{weight}/1200</Text></Text>
      </Box>
    </Box>
  );
};

const MessageHistory = ({ messages }: { messages: ChatMessage[] }): React.JSX.Element => (
  <Box flexDirection="column">
    {messages.map((m) => (
      <Box key={m.id} flexDirection="column" marginBottom={1}>
        {m.role === 'user' ? (
          <Text bold color="blue">👤 You: {m.content}</Text>
        ) : (
          <Box flexDirection="column">
            {m.thoughts && (
              <Box marginY={1} paddingLeft={1} borderStyle="single" borderLeft borderColor="gray">
                <Text color="gray" italic>🧠 {m.thoughts.trim()}</Text>
              </Box>
            )}
            {m.tools?.map((t, idx) => (
              <Text key={`${t.name}-${idx}`} color="green">
                🛠️ {t.name}({JSON.stringify(t.args)}) {t.result ? `-> ${t.result}...` : ''}
              </Text>
            ))}
            <Text bold color="cyan">💬 Agent: {m.content}</Text>
          </Box>
        )}
      </Box>
    ))}
  </Box>
);

interface LiveTurnProps {
  busy: boolean;
  status: string;
  thoughts: string;
  tools: ToolEntry[];
  response: string;
}

const LiveTurn = ({ busy, status, thoughts, tools, response }: LiveTurnProps): React.JSX.Element => {
  const spinner = useSpinner(busy);
  if (!busy && !response) return <Box />;

  return (
    <Box flexDirection="column" marginY={1}>
      {busy && <Text color="yellow">{spinner} {status}</Text>}
      {thoughts.length > 0 && (
        <Box marginY={1} paddingLeft={1} borderStyle="single" borderLeft borderColor="gray">
          <Text color="gray" italic>🧠 {thoughts.trim()}</Text>
        </Box>
      )}
      {tools.map((t, idx) => (
        <Text key={`live-${t.name}-${idx}`} color="green">
          🛠️ {t.name}({JSON.stringify(t.args)}) {t.result ? `-> ${t.result}...` : ''}
        </Text>
      ))}
      {response.length > 0 && <Text color="cyan">💬 Agent: {response}</Text>}
    </Box>
  );
};

interface InputProps {
  value: string;
  busy: boolean;
  onSubmit: () => void;
  onChange: (val: string) => void;
}

const PromptInput = ({ value, busy, onSubmit, onChange }: InputProps): React.JSX.Element => {
  const { exit } = useApp();

  useInput((input, key) => {
    if (key.ctrl && (input === 'c' || input === '\u0003')) {
      exit();
      return;
    }
    if (busy) return;
    if (key.return) {
      onSubmit();
    } else if (key.backspace || key.delete) {
      onChange(value.slice(0, -1));
    } else if (!key.ctrl && !key.meta && input) {
      onChange(value + input);
    }
  });

  return (
    <Box borderStyle="single" borderColor={busy ? 'gray' : 'green'} paddingX={1}>
      <Text bold color={busy ? 'gray' : 'green'}>💬 You &gt; </Text>
      <Text>{value}</Text>
      {!busy && <Text color="green">█</Text>}
    </Box>
  );
};

interface ChatHandlers {
  setStatus: (s: string) => void;
  setThoughts: React.Dispatch<React.SetStateAction<string>>;
  setTools: React.Dispatch<React.SetStateAction<ToolEntry[]>>;
  setResponse: React.Dispatch<React.SetStateAction<string>>;
}

const createLiveHooks = (handlers: ChatHandlers): AgentHooks => ({
  onThinking: (chunk: string): void => {
    handlers.setStatus('Reasoning...');
    handlers.setThoughts((prev) => prev + chunk);
  },
  onToolCallStart: (call): void => {
    handlers.setStatus(`Calling ${call.function.name}...`);
    handlers.setTools((prev) => [...prev, { name: call.function.name, args: call.function.arguments }]);
  },
  onToolCallEnd: (res): void => {
    handlers.setTools((prev) =>
      prev.map((t, idx) => (idx === prev.length - 1 ? { ...t, result: res.outputString.slice(0, 60) } : t))
    );
  },
  onToken: (token: string): void => {
    handlers.setStatus('Responding...');
    handlers.setResponse((prev) => prev + token);
  },
});

const useAgentChat = (): {
  messages: ChatMessage[];
  isBusy: boolean;
  status: string;
  thoughts: string;
  tools: ToolEntry[];
  response: string;
  sendMessage: (prompt: string) => Promise<void>;
} => {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isBusy, setIsBusy] = useState(false);
  const [status, setStatus] = useState('Idle');
  const [thoughts, setThoughts] = useState('');
  const [tools, setTools] = useState<ToolEntry[]>([]);
  const [response, setResponse] = useState('');

  const sendMessage = useCallback(async (text: string): Promise<void> => {
    setIsBusy(true);
    setStatus('Thinking with ReAct...');
    setThoughts('');
    setTools([]);
    setResponse('');
    setMessages((prev) => [...prev, { id: String(Date.now()), role: 'user', content: text }]);

    const hooks = createLiveHooks({ setStatus, setThoughts, setTools, setResponse });
    const answer = await runTradingAgent(text, { hooks });

    setMessages((prev) => [...prev, { id: String(Date.now()), role: 'agent', content: answer, thoughts, tools }]);
    setIsBusy(false);
    setStatus('Idle');
  }, [thoughts, tools]);

  return { messages, isBusy, status, thoughts, tools, response, sendMessage };
};

export const App = (): React.JSX.Element => {
  const { exit } = useApp();
  const [inputVal, setInputVal] = useState('');
  const chat = useAgentChat();

  const handleSubmit = useCallback((): void => {
    const trimmed = inputVal.trim();
    if (!trimmed) return;
    if (trimmed.toLowerCase() === 'exit' || trimmed.toLowerCase() === 'quit') {
      exit();
      return;
    }
    setInputVal('');
    void chat.sendMessage(trimmed);
  }, [inputVal, chat, exit]);

  return (
    <Box flexDirection="column" padding={1}>
      <Header />
      <MessageHistory messages={chat.messages} />
      <LiveTurn
        busy={chat.isBusy}
        status={chat.status}
        thoughts={chat.thoughts}
        tools={chat.tools}
        response={chat.response}
      />
      <PromptInput value={inputVal} busy={chat.isBusy} onSubmit={handleSubmit} onChange={setInputVal} />
    </Box>
  );
};
