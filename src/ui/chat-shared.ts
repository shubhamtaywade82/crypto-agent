import type React from 'react';
import { marked, Renderer } from 'marked';
import TerminalRenderer from 'marked-terminal';
import type { AgentHooks } from '@nemesis-oss/ollama-sdk';

const termR = new TerminalRenderer({ showSectionPrefix: false, tab: 2 }) as unknown as InstanceType<typeof Renderer> & {
  text: (tok: unknown) => string; parser: { parseInline: (t: unknown) => string }; o: { text: (t: unknown) => string };
};
termR.text = function (t: unknown): string {
  const tok = t && typeof t === 'object' && 'tokens' in t && (t as { tokens: unknown }).tokens;
  return tok ? this.parser.parseInline(tok) : this.o.text(typeof t === 'object' && t && 'text' in t ? (t as { text: unknown }).text : t);
};
termR.hr = (): string => `\n${'─'.repeat(Math.max(20, (process.stdout.columns || 80) - 4))}\n\n`;
marked.setOptions({ renderer: termR as unknown as InstanceType<typeof Renderer> });

export const renderMarkdown = (t: string): string => {
  try { return t ? (marked.parse(t) as string).trim() : ''; } catch { return t; }
};

export const formatToolArgs = (a: unknown): string => {
  const s = (!a || (typeof a === 'object' && Object.keys(a).length === 0)) ? '' : (typeof a === 'string' ? a : JSON.stringify(a)).replace(/\s+/g, ' ').trim();
  return s.length > 50 ? `${s.slice(0, 47)}...` : s;
};

export const formatToolResult = (raw: string): string => {
  try {
    const p = JSON.parse(raw) as Record<string, unknown>;
    const c = Array.isArray(p) ? `[${p.length} items]` : (p?.error ? `Error: ${String(p.error)}` : JSON.stringify(p));
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

export interface ChatMessage {
  readonly id: string;
  readonly role: 'user' | 'agent' | 'system' | 'trigger';
  readonly title?: string;
  readonly content: string;
  readonly steps?: AgentStep[];
}

export const createLiveHooks = (handlers: {
  collector: { steps: AgentStep[] };
  setStatus: (s: string) => void;
  setSteps: React.Dispatch<React.SetStateAction<AgentStep[]>>;
  setResponse: React.Dispatch<React.SetStateAction<string>>;
}): AgentHooks => {
  const sync = (): void => handlers.setSteps([...handlers.collector.steps]);
  return {
    onThinking: (chunk: string): void => {
      const last = handlers.collector.steps[handlers.collector.steps.length - 1];
      if (last?.type === 'thought') last.content += chunk;
      else handlers.collector.steps.push({ type: 'thought', content: chunk });
      handlers.setStatus('Reasoning...');
      sync();
    },
    onToolCallStart: (c): void => {
      handlers.collector.steps.push({ type: 'tool', tool: { id: c.id, name: c.function.name, args: c.function.arguments } });
      handlers.setStatus(`Calling ${c.function.name}...`);
      sync();
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
