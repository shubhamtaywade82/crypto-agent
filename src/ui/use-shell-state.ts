import type React from 'react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { WatchOrchestrator } from '../engine/orchestrator.js';
import { PromptHistory } from './history.js';
import type { ActivityEntry } from './KernelDashboard.js';
import { useAgentChat, usePortfolio } from './app-hooks.js';
import { runCommand } from './app-commands.js';
import { useAutoScan, useStreamBoot } from './use-app-boot.js';
import type { PortfolioState } from '../domain/portfolio/portfolio-state.js';

const SPINNER = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'] as const;

const useBusySpinner = (busy: boolean): string => {
  const [frame, setFrame] = useState(0);
  useEffect(() => {
    if (!busy) return undefined;
    const t = setInterval(() => setFrame((f) => (f + 1) % SPINNER.length), 80);
    return (): void => clearInterval(t);
  }, [busy]);
  return SPINNER[frame] ?? '⠋';
};

const useActivityLog = (): {
  readonly activity: ActivityEntry[];
  readonly pushActivity: (text: string) => void;
  readonly setActivity: React.Dispatch<React.SetStateAction<ActivityEntry[]>>;
} => {
  const [activity, setActivity] = useState<ActivityEntry[]>([]);
  const pushActivity = useCallback((text: string): void => {
    const at = new Date().toLocaleTimeString('en-IN', { hour12: false });
    setActivity((prev) => [{ id: `${Date.now()}`, at, text }, ...prev].slice(0, 20));
  }, []);
  return { activity, pushActivity, setActivity };
};

const noopMany = (_e: readonly import('./transcript.js').TranscriptEntry[]): void => undefined;
const noopOne = (_e: import('./transcript.js').TranscriptEntry): void => undefined;

export const useShellState = (_exit: () => void): {
  readonly mode: 'ops' | 'chat';
  readonly setMode: React.Dispatch<React.SetStateAction<'ops' | 'chat'>>;
  readonly focusSymbol: string;
  readonly setFocusSymbol: (s: string) => void;
  readonly auto: { enabled: boolean; interval: number };
  readonly setAuto: React.Dispatch<React.SetStateAction<{ enabled: boolean; interval: number }>>;
  readonly activity: ActivityEntry[];
  readonly setActivity: React.Dispatch<React.SetStateAction<ActivityEntry[]>>;
  readonly streamLive: boolean;
  readonly port: PortfolioState;
  readonly chat: ReturnType<typeof useAgentChat>;
  readonly orchestrator: WatchOrchestrator;
  readonly history: PromptHistory;
  readonly pushActivity: (text: string) => void;
  readonly spinner: string;
} => {
  const defaultSym = (process.env.KERNEL_SYMBOLS ?? 'BTCUSDT').split(',')[0]?.trim().toUpperCase() ?? 'BTCUSDT';
  const [mode, setMode] = useState<'ops' | 'chat'>('ops');
  const [focusSymbol, setFocusSymbol] = useState(defaultSym);
  const [auto, setAuto] = useState({ enabled: true, interval: 300 });
  const { activity, pushActivity, setActivity } = useActivityLog();
  const orchestrator = useMemo(() => new WatchOrchestrator(), []);
  const history = useMemo(() => new PromptHistory(), []);
  const chat = useAgentChat(orchestrator, pushActivity, noopMany, noopOne);
  const streamLive = useStreamBoot();
  useAutoScan(auto.enabled, auto.interval, chat.runKernelScan, chat.isBusy);
  const port = usePortfolio(orchestrator);
  const spinner = useBusySpinner(chat.isBusy);
  return {
    mode, setMode, focusSymbol, setFocusSymbol, auto, setAuto,
    activity, setActivity, streamLive, port, chat, orchestrator, history, pushActivity, spinner,
  };
};

export const useSubmitHandler = (
  s: ReturnType<typeof useShellState>,
  inputVal: string,
  setInputVal: (v: string) => void,
  exit: () => void
): () => void =>
  useCallback((): void => {
    const t = inputVal.trim();
    if (!t) return;
    s.history.save(t); setInputVal('');
    if (!runCommand({
      input: t, focusSymbol: s.focusSymbol, setFocusSymbol: s.setFocusSymbol,
      setAuto: s.setAuto, chat: s.chat, pushActivity: s.pushActivity,
      pushTranscript: (): void => undefined, clearTranscript: (): void => s.setActivity([]), exit,
    })) {
      s.setMode('chat');
      void s.chat.runTurn(t);
    }
  }, [s, inputVal, setInputVal, exit]);
