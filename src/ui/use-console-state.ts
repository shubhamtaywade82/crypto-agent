import type React from 'react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { WatchOrchestrator } from '../engine/orchestrator.js';
import { PromptHistory } from './history.js';
import { useAgentChat, usePortfolio } from './app-hooks.js';
import { runCommand } from './app-commands.js';
import { useAutoScan, useStreamBoot } from './use-app-boot.js';
import {
  agentEntry, systemEntry, type TranscriptEntry, userEntry,
} from './transcript.js';
import {
  mergeScanOpportunities, opportunitiesFromTrace, type ScanOpportunity,
} from './scan-opportunities.js';
import type { PipelineTrace } from '../engines/pipeline.js';

const SPINNER = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'] as const;

const useSpinner = (busy: boolean): string => {
  const [frame, setFrame] = useState(0);
  useEffect(() => {
    if (!busy) return undefined;
    const t = setInterval(() => setFrame((f) => (f + 1) % SPINNER.length), 80);
    return (): void => clearInterval(t);
  }, [busy]);
  return SPINNER[frame] ?? '⠋';
};

const useTranscriptBuffer = (orchestrator: WatchOrchestrator): {
  readonly transcript: TranscriptEntry[];
  readonly pushTranscript: (e: TranscriptEntry) => void;
  readonly appendMany: (entries: readonly TranscriptEntry[]) => void;
  readonly clearTranscript: () => void;
  readonly watchCount: number;
} => {
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([]);
  const [watchCount, setWatchCount] = useState(0);
  const pushTranscript = useCallback((e: TranscriptEntry): void => {
    setTranscript((prev) => [...prev, e].slice(-200));
  }, []);
  const appendMany = useCallback((entries: readonly TranscriptEntry[]): void => {
    setTranscript((prev) => [...prev, ...entries].slice(-200));
  }, []);

  useEffect(() => {
    pushTranscript(systemEntry('Boot', ['Crypto-agent console ready — transcript stream active', 'Type /help or ? for commands']));
    const poll = setInterval(() => setWatchCount(orchestrator.getStatuses().length), 2000);
    const unsub = orchestrator.onTrigger((ev) => {
      pushTranscript({
        id: `watch-${Date.now()}`, at: new Date().toLocaleTimeString('en-IN', { hour12: false }),
        actor: 'MARKET', title: `${ev.condition.symbol} watch triggered`,
        lines: [`${ev.condition.strategy} @ $${ev.condition.targetPrice}`, `now=$${ev.currentPrice}`],
      });
    });
    return (): void => { clearInterval(poll); unsub(); };
  }, [orchestrator, pushTranscript]);

  return { transcript, pushTranscript, appendMany, clearTranscript: (): void => setTranscript([]), watchCount };
};

export interface ConsoleState {
  readonly transcript: TranscriptEntry[];
  readonly pushTranscript: (e: TranscriptEntry) => void;
  readonly appendMany: (entries: readonly TranscriptEntry[]) => void;
  readonly clearTranscript: () => void;
  readonly focusSymbol: string;
  readonly setFocusSymbol: (s: string) => void;
  readonly auto: { enabled: boolean; interval: number };
  readonly setAuto: React.Dispatch<React.SetStateAction<{ enabled: boolean; interval: number }>>;
  readonly streamLive: boolean;
  readonly port: ReturnType<typeof usePortfolio>;
  readonly chat: ReturnType<typeof useAgentChat>;
  readonly orchestrator: WatchOrchestrator;
  readonly history: PromptHistory;
  readonly watchCount: number;
  readonly spinner: string;
  readonly opportunities: readonly ScanOpportunity[];
  readonly clearOpportunities: () => void;
}

export const useConsoleState = (_exit: () => void): ConsoleState => {
  const defaultSym = (process.env.KERNEL_SYMBOLS ?? 'BTCUSDT').split(',')[0]?.trim().toUpperCase() ?? 'BTCUSDT';
  const [focusSymbol, setFocusSymbol] = useState(defaultSym);
  const [auto, setAuto] = useState({ enabled: true, interval: 300 });
  const [opportunities, setOpportunities] = useState<ScanOpportunity[]>([]);
  const orchestrator = useMemo(() => new WatchOrchestrator(), []);
  const history = useMemo(() => new PromptHistory(), []);
  const { transcript, pushTranscript, appendMany, clearTranscript, watchCount } = useTranscriptBuffer(orchestrator);

  const onActivity = useCallback((text: string): void => {
    pushTranscript(systemEntry('Activity', [text]));
  }, [pushTranscript]);

  const ingestTrace = useCallback((_symbol: string, trace: PipelineTrace): void => {
    setOpportunities((prev) => mergeScanOpportunities(prev, opportunitiesFromTrace(_symbol, trace)));
  }, []);

  const chat = useAgentChat(orchestrator, onActivity, appendMany, pushTranscript, ingestTrace);
  const streamLive = useStreamBoot();
  useAutoScan(auto.enabled, auto.interval, chat.runKernelScan, chat.isBusy);
  const port = usePortfolio(orchestrator);
  const spinner = useSpinner(chat.isBusy);

  return {
    transcript, pushTranscript, appendMany, clearTranscript,
    focusSymbol, setFocusSymbol, auto, setAuto, streamLive, port, chat,
    orchestrator, history, watchCount, spinner, opportunities,
    clearOpportunities: (): void => setOpportunities([]),
  };
};

export interface ConsoleSubmitOpts {
  readonly s: ReturnType<typeof useConsoleState>;
  readonly inputVal: string;
  readonly setInputVal: (v: string) => void;
  readonly filterMode: boolean;
  readonly setFilterQuery: (q: string) => void;
  readonly setFilterMode: (b: boolean) => void;
  readonly exit: () => void;
}

export const useConsoleSubmit = (p: ConsoleSubmitOpts): () => void =>
  useCallback((): void => {
    const t = p.inputVal.trim();
    if (!t) return;
    if (p.filterMode) { p.setFilterQuery(t); p.setInputVal(''); p.setFilterMode(false); return; }
    p.s.history.save(t);
    p.setInputVal('');
    if (!runCommand({
      input: t, focusSymbol: p.s.focusSymbol, setFocusSymbol: p.s.setFocusSymbol,
      setAuto: p.s.setAuto, chat: p.s.chat,
      pushActivity: (text) => p.s.pushTranscript(systemEntry('Command', [text])),
      clearTranscript: (): void => { p.s.clearTranscript(); p.s.clearOpportunities(); },
      pushTranscript: p.s.pushTranscript,
      exit: p.exit,
    })) {
      p.s.pushTranscript(userEntry(t));
      void p.s.chat.runTurn(t).then((answer) => {
        if (answer) p.s.pushTranscript(agentEntry(answer, answer));
      });
    }
  }, [p]);
