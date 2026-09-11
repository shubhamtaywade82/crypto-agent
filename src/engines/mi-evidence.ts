import {
  runObservationStudy,
  toResearchResult,
  type EvidenceStatus,
  type ResearchResult,
} from '@nemesis-oss/market-research';
import type { Candle, Timeframe } from '../domain/market/types.js';
import type { CouncilTrigger } from './council-types.js';
import type { MiEventKind } from './mi-event-scan.js';
import type { SetupCandidate, SetupType } from './setup-engine.js';
import { toMiCandles, toMiTimeframe } from './mi-candle-adapter.js';

const MIN_BARS = 100;
const DEFAULT_HORIZON = Number(process.env.MI_EVIDENCE_HORIZON ?? 24);

export interface EvidenceSnapshot {
  readonly symbol: string;
  readonly timeframe: Timeframe;
  readonly refreshedAt: number;
  readonly candleCount: number;
  readonly results: readonly ResearchResult[];
}

const SETUP_EVENT_MAP: Record<SetupType, readonly string[]> = {
  PULLBACK_RECLAIM: ['choch', 'order_block'],
  LIQUIDITY_SWEEP_REVERSAL: ['liquidity_sweep'],
  BREAKOUT_RETEST: ['bos', 'fvg'],
  TREND_CONTINUATION: ['bos', 'displacement'],
};

const MI_EVENT_MAP: Record<MiEventKind, string> = {
  choch: 'choch',
  liquidity_sweep: 'liquidity_sweep',
};

const DEFAULT_EVENTS = ['liquidity_sweep', 'choch', 'bos'] as const;

export const evidenceStudyTf = (): Timeframe =>
  (process.env.MI_EVIDENCE_TF ?? '1h') as Timeframe;

const pct = (v: number): string => `${(v * 100).toFixed(0)}%`;

export const formatEvidenceLine = (r: ResearchResult): string => {
  const rr = r.descriptive.reachRates;
  const ctrl = r.controls.matchedHitRateR2;
  const uplift = r.effect.uplift;
  const status = r.evidenceStatus ?? 'descriptive_only';
  const p = r.dependence.pValueEstimate;
  return [
    `${r.sample.eventType}: 2R=${pct(rr.r2)} ctrl=${pct(ctrl)} uplift=${pct(uplift)}`,
    `status=${status} n=${r.sample.sampleSize} p=${p.toFixed(3)}`,
  ].join(' · ');
};

export const formatEvidenceBlock = (results: readonly ResearchResult[]): string =>
  results.length > 0 ? results.map(formatEvidenceLine).join('\n') : 'none (insufficient history)';

export const pickEvidenceResults = (
  snap: EvidenceSnapshot,
  eventTypes: readonly string[]
): readonly ResearchResult[] => {
  const wanted = new Set(eventTypes);
  return snap.results.filter((r) => wanted.has(r.sample.eventType));
};

export const eventTypesForCouncil = (
  trigger: CouncilTrigger,
  setups: readonly SetupCandidate[]
): readonly string[] => {
  const types = new Set<string>();
  if (trigger.type === 'MARKET_EVENT') types.add(MI_EVENT_MAP[trigger.eventType]);
  for (const s of setups) {
    for (const t of SETUP_EVENT_MAP[s.type]) types.add(t);
  }
  if (types.size === 0) DEFAULT_EVENTS.forEach((t) => types.add(t));
  return [...types];
};

export const runEvidenceStudy = (
  symbol: string,
  timeframe: Timeframe,
  candles: readonly Candle[]
): EvidenceSnapshot | undefined => {
  if (candles.length < MIN_BARS) return undefined;
  const miCandles = toMiCandles(candles);
  const study = runObservationStudy(miCandles, {
    symbol,
    timeframe: toMiTimeframe(timeframe),
    horizonCandles: DEFAULT_HORIZON,
    ambiguityPolicy: 'pessimistic',
  });
  const provenance = {
    datasetId: `${symbol}-${timeframe}`, datasetHash: 'runtime', detectorVersion: '1.0.0',
    detectorConfigHash: 'runtime', outcomeConfigHash: 'runtime', outcomeVersion: '1.0.0',
  };
  const results = study.results.map((row) =>
    toResearchResult(row, miCandles.length, { ...provenance, detectorId: row.eventType },
      study.matchRatios.get(row.eventType))
  );
  return { symbol, timeframe, refreshedAt: Date.now(), candleCount: candles.length, results };
};

export const isActionableEvidence = (status: EvidenceStatus | undefined): boolean =>
  status === 'robust' || status === 'exploratory' || status === 'oos_supported';
