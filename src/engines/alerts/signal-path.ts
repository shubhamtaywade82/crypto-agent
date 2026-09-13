import type { AlertEvent } from '../../domain/alerts/types.js';
import type { MarketAnalysis } from '../../agents/schemas.js';
import type { MarketState } from '../../domain/market/types.js';
import type { SetupCandidate } from '../setup-engine.js';
import type { PipelineTrace } from '../pipeline.js';
import { makeAlert } from './make-alert.js';
import type { AlertDispatcher } from './dispatcher.js';
import { sendTelegramHtml, escapeHtml } from '../../notifications/telegram.js';
import type { MacroPolicy } from './macro-policy.js';

export const compactSignalBody = (
  c: SetupCandidate,
  state: MarketState,
  analysis?: MarketAnalysis
): string => {
  const htf = `${state.timeframes['4h'].structure.trend} / ${state.timeframes['1h'].structure.trend}`;
  const lines = [
    `${c.direction} ${c.type}`,
    `${c.entry.toFixed(2)}–${(c.entry * 1.001).toFixed(2)}`,
    `HTF: ${htf} · RR ${c.rr.toFixed(1)}+ · ${(c.confidence * 100).toFixed(0)}%`,
    `SL: ${c.stopLoss.toFixed(2)}  TP: ${c.takeProfit.toFixed(2)}`,
  ];
  if (analysis) lines.push(analysis.summary.slice(0, 180));
  return lines.join('\n');
};

const maybeDetailTelegram = async (
  candidate: SetupCandidate,
  analysis?: MarketAnalysis
): Promise<void> => {
  if (process.env.TELEGRAM_SIGNAL_DETAIL !== 'full' || !analysis) return;
  await sendTelegramHtml(
    `<b>[ SIGNAL DETAIL ]</b> ${escapeHtml(candidate.symbol)}\n${escapeHtml(analysis.summary)}`,
    { channel: 'trading', silent: false }
  );
};

const signalAlert = (
  candidate: SetupCandidate,
  state: MarketState,
  extras: {
    readonly analysis?: MarketAnalysis;
    readonly trace?: PipelineTrace;
    readonly macroNote?: string;
  }
): AlertEvent => makeAlert({
  at: state.capturedAt,
  class: 'SIGNAL',
  severity: 'SIGNAL',
  symbol: candidate.symbol,
  title: `TRADE SIGNAL — ${candidate.symbol} ${candidate.direction}`,
  body: [
    compactSignalBody(candidate, state, extras.analysis),
    extras.macroNote,
    extras.trace ? `Pipeline: ${extras.trace.status}` : '',
  ].filter(Boolean).join('\n'),
  fingerprint: `SIGNAL:${candidate.symbol}:${candidate.type}:${candidate.direction}`,
  stateTo: 'CONFIRMED',
  payload: {
    confidence: candidate.confidence,
    rr: candidate.rr,
    analysis: extras.analysis,
    setupType: candidate.type,
    entry: candidate.entry,
    stopLoss: candidate.stopLoss,
    takeProfit: candidate.takeProfit,
  },
});

export const publishSignal = async (
  dispatcher: AlertDispatcher,
  candidate: SetupCandidate,
  state: MarketState,
  extras: {
    readonly analysis?: MarketAnalysis;
    readonly trace?: PipelineTrace;
    readonly macroNote?: string;
  } = {}
): Promise<void> => {
  await dispatcher.publish(signalAlert(candidate, state, extras));
  await maybeDetailTelegram(candidate, extras.analysis);
};

export const macroBlocksNewRisk = (policy: MacroPolicy): boolean =>
  policy.risk() === 'VERY_HIGH';
