import type { MarketState } from '../domain/market/types.js';
import type { PipelineTrace } from '../engines/pipeline.js';

export type PipelineSnapshots = Readonly<Record<string, PipelineTrace>>;

export const trendArrow = (trend: string): string => {
  if (trend.includes('UP') || trend === 'BULLISH') return '↑';
  if (trend.includes('DOWN') || trend === 'BEARISH') return '↓';
  return '→';
};

export const mtfTrendLine = (state?: MarketState): string => {
  if (!state) return '—';
  const tf = state.timeframes;
  return `4H:${trendArrow(tf['4h'].structure.trend)} │ 1H:${trendArrow(tf['1h'].structure.trend)} │ 15m:${trendArrow(tf['15m'].structure.trend)} │ 5m:${trendArrow(tf['5m']?.structure.trend ?? 'NEUTRAL')}`;
};

export const pipelineAge = (ranAt: number): string => {
  const sec = Math.max(0, Math.floor((Date.now() - ranAt) / 1000));
  if (sec < 60) return `${sec}s ago`;
  return `${Math.floor(sec / 60)}m ago`;
};

export const traceForSymbol = (
  snapshots: PipelineSnapshots,
  symbol: string
): PipelineTrace | undefined => snapshots[symbol.toUpperCase()];

export const topSetup = (trace: PipelineTrace): PipelineTrace['setups'][number] | undefined => {
  const id = trace.outcome?.candidateId;
  if (id) return trace.setups.find((s) => s.id === id) ?? trace.setups[0];
  return trace.setups[0];
};
