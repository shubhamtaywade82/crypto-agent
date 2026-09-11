import type { PipelineTrace } from '../engines/pipeline.js';
import type { SetupCandidate, SetupType } from '../engines/setup-engine.js';
import type { MarketState } from '../domain/market/types.js';

export interface ScanOpportunity {
  readonly symbol: string;
  readonly setup: string;
  readonly direction: 'LONG' | 'SHORT';
  readonly tf: string;
  readonly confidence: number;
  readonly regime: string;
  readonly rr: number;
  readonly state: string;
  readonly thesis: string;
  readonly mtf: string;
  readonly scannedAt: string;
}

const SETUP_LABEL: Record<SetupType, string> = {
  PULLBACK_RECLAIM: 'Pullback Reclaim',
  LIQUIDITY_SWEEP_REVERSAL: 'Liquidity Sweep',
  BREAKOUT_RETEST: 'Breakout Retest',
  TREND_CONTINUATION: 'Trend Continuation',
};

const trendArrow = (trend: string): string => {
  if (trend.includes('UP') || trend === 'BULLISH') return '↑';
  if (trend.includes('DOWN') || trend === 'BEARISH') return '↓';
  return '→';
};

const mtfLine = (state?: MarketState): string => {
  if (!state) return '—';
  const tf = state.timeframes;
  return `4H${trendArrow(tf['4h'].structure.trend)} 1H${trendArrow(tf['1h'].structure.trend)} 15m${trendArrow(tf['15m'].structure.trend)}`;
};

const statusForSetup = (setup: SetupCandidate, trace: PipelineTrace): string => {
  if (!setup.valid || trace.status === 'REJECTED' || trace.status === 'INVALID_PROPOSAL') return 'REJECTED';
  if (trace.status === 'EXECUTED' && trace.outcome?.candidateId === setup.id) return 'EXECUTED';
  if (trace.risk?.approved === false) return 'REJECTED';
  if (trace.status === 'APPROVED' && trace.outcome?.candidateId === setup.id) return 'READY';
  if (trace.outcome?.candidateId === setup.id) return 'ANALYZING';
  if (trace.status === 'HALTED') return 'HALTED';
  return setup.confidence >= 0.7 ? 'WATCH' : 'SCANNED';
};

const confidenceFor = (setup: SetupCandidate, trace: PipelineTrace): number =>
  trace.outcome?.candidateId === setup.id ? trace.outcome.confidence : setup.confidence;

export const opportunitiesFromTrace = (symbol: string, trace: PipelineTrace): ScanOpportunity[] => {
  const at = new Date().toLocaleTimeString('en-IN', { hour12: false });
  return trace.setups.map((setup) => ({
    symbol,
    setup: SETUP_LABEL[setup.type],
    direction: setup.direction,
    tf: '1h',
    confidence: confidenceFor(setup, trace),
    regime: trace.regime,
    rr: setup.rr,
    state: statusForSetup(setup, trace),
    thesis: setup.thesis,
    mtf: mtfLine(trace.state),
    scannedAt: at,
  }));
};

export const mergeScanOpportunities = (
  prev: readonly ScanOpportunity[],
  incoming: readonly ScanOpportunity[]
): ScanOpportunity[] => {
  const byKey = new Map<string, ScanOpportunity>();
  for (const row of prev) byKey.set(`${row.symbol}:${row.setup}`, row);
  for (const row of incoming) byKey.set(`${row.symbol}:${row.setup}`, row);
  return [...byKey.values()]
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, 24);
};
