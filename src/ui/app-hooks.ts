import { useCallback, useEffect, useState } from 'react';
import { runTradingAgent } from '../agent.js';
import type { WatchOrchestrator } from '../engine/orchestrator.js';
import { getKernel, type TradingKernel } from '../kernel.js';
import type { PortfolioState } from '../domain/portfolio/portfolio-state.js';
import { createLiveHooks, type AgentStep, type ChatMessage } from './chat-shared.js';
import type { PipelineTrace } from '../engines/pipeline.js';
import { pipelineToEntries, type TranscriptEntry } from './transcript.js';

const DEFAULT_SYMBOLS = (process.env.KERNEL_SYMBOLS ?? 'BTCUSDT,SOLUSDT').split(',').map((s) => s.trim().toUpperCase());

export const formatTrace = (symbol: string, trace: Awaited<ReturnType<TradingKernel['runPipeline']>>): string => {
  const setups = trace.setups.length ? trace.setups.map((s) => `${s.type} RR${s.rr.toFixed(1)}`).join(', ') : 'none';
  const micro = trace.state?.microstructure;
  const flow = micro ? ` flow=${micro.flowBias} imb=${(micro.imbalance * 100).toFixed(0)}%` : '';
  return `${symbol} ${trace.status} ${trace.regime} setups=[${setups}]${flow}`;
};

interface PipelineRunnerOpts {
  readonly onActivity: (text: string) => void;
  readonly appendMany: (entries: readonly TranscriptEntry[]) => void;
  readonly onTrace?: (symbol: string, trace: PipelineTrace) => void;
  readonly appendMsg: (m: ChatMessage) => void;
  readonly setBusy: (b: boolean) => void;
  readonly setStatus: (s: string) => void;
}

const usePipelineRunner = (opts: PipelineRunnerOpts): {
  runPipelineTrace: (symbol: string) => Promise<void>;
  runKernelScan: (symbols?: readonly string[]) => Promise<void>;
} => {
  const { onActivity, appendMany, onTrace, appendMsg, setBusy, setStatus } = opts;
  const runPipelineTrace = useCallback(async (symbol: string): Promise<void> => {
    setBusy(true); setStatus(`Pipeline ${symbol}...`);
    try {
      const trace = await getKernel().runPipeline(symbol);
      if (onTrace) onTrace(symbol, trace);
      else appendMany(pipelineToEntries(symbol, trace));
      appendMsg({ id: String(Date.now()), role: 'system', title: `🛡️ ${symbol}`, content: formatTrace(symbol, trace) });
    } catch (err) {
      onActivity(`ERR ${symbol}: ${err instanceof Error ? err.message : String(err)}`);
    } finally { setBusy(false); setStatus('Idle'); }
  }, [appendMany, appendMsg, onActivity, onTrace, setBusy, setStatus]);

  const runKernelScan = useCallback(async (symbols?: readonly string[]): Promise<void> => {
    const targets = symbols?.length ? symbols : DEFAULT_SYMBOLS;
    onActivity(`Autonomous scan started (${targets.join(', ')})`);
    for (const sym of targets) await runPipelineTrace(sym);
    onActivity(`Autonomous scan completed (${targets.length} symbols evaluated)`);
  }, [onActivity, runPipelineTrace]);

  return { runPipelineTrace, runKernelScan };
};

export interface AgentChatOpts {
  readonly orchestrator: WatchOrchestrator;
  readonly onActivity: (text: string) => void;
  readonly appendMany: (entries: readonly TranscriptEntry[]) => void;
  readonly onTrace?: (symbol: string, trace: PipelineTrace) => void;
}

export interface AgentChatResult {
  readonly messages: ChatMessage[];
  readonly isBusy: boolean;
  readonly status: string;
  readonly steps: AgentStep[];
  readonly response: string;
  readonly runTurn: (prompt: string) => Promise<string>;
  readonly runPipelineTrace: (sym: string) => Promise<void>;
  readonly runKernelScan: (syms?: readonly string[]) => Promise<void>;
  readonly clearMessages: () => void;
  readonly addSystemNote: (msg: string) => void;
}

export const useAgentChat = (opts: AgentChatOpts): AgentChatResult => {
  const { orchestrator, onActivity, appendMany, onTrace } = opts;
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isBusy, setIsBusy] = useState(false);
  const [status, setStatus] = useState('Idle');
  const [steps, setSteps] = useState<AgentStep[]>([]);
  const [response, setResponse] = useState('');
  const appendMsg = useCallback((m: ChatMessage): void => setMessages((p) => [...p, m].slice(-15)), []);
  const { runPipelineTrace, runKernelScan } = usePipelineRunner({
    onActivity, appendMany, onTrace, appendMsg, setBusy: setIsBusy, setStatus,
  });

  const runTurn = useCallback(async (prompt: string): Promise<string> => {
    const collector = { steps: [] as AgentStep[] };
    setIsBusy(true); setStatus('ReAct...'); setSteps([]); setResponse('');
    appendMsg({ id: String(Date.now()), role: 'user', content: prompt });
    const answer = await runTradingAgent(prompt, {
      hooks: createLiveHooks({ collector, setStatus, setSteps, setResponse }), orchestrator,
    });
    appendMsg({ id: String(Date.now()), role: 'agent', content: answer, steps: [...collector.steps] });
    setSteps([]); setResponse(''); setIsBusy(false); setStatus('Idle');
    return answer;
  }, [orchestrator, appendMsg]);

  return {
    messages, isBusy, status, steps, response, runTurn, runPipelineTrace, runKernelScan,
    clearMessages: (): void => setMessages([]),
    addSystemNote: (msg: string): void => appendMsg({ id: String(Date.now()), role: 'system', content: msg }),
  };
};

export const usePortfolio = (orchestrator: WatchOrchestrator): PortfolioState => {
  const [port, setPort] = useState<PortfolioState>(() => getKernel().portfolio.peek());
  useEffect(() => {
    orchestrator.start();
    const poll = setInterval(() => { void getKernel().portfolio.refresh().then(setPort).catch(() => {}); }, 1000);
    return (): void => { clearInterval(poll); orchestrator.stop(); };
  }, [orchestrator]);
  return port;
};
