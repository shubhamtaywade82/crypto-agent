import { getKernel } from '../kernel.js';
import { deriveCircuitState } from '../domain/risk/risk-config.js';
import type { PipelineTrace } from '../engines/pipeline.js';
import { regimeGates } from '../engines/setup-engine.js';
import type { ScanOpportunity } from './scan-opportunities.js';
import { mtfTrendLine, pipelineAge, topSetup, traceForSymbol, type PipelineSnapshots } from './pipeline-view.js';
import { fmtPrice } from './KernelDashboard.js';

export type TraderStance = 'LONG' | 'SHORT' | 'WAIT' | 'AVOID' | 'MONITOR';

export interface TraderLevels {
  readonly support?: number;
  readonly resistance?: number;
  readonly entry?: number;
  readonly stop?: number;
  readonly target?: number;
  readonly rr?: number;
}

export interface TraderBrief {
  readonly symbol: string;
  readonly stance: TraderStance;
  readonly headline: string;
  readonly confidence: number | null;
  readonly setup: string | null;
  readonly regime: string;
  readonly mtf: string;
  readonly thesis: string | null;
  readonly trigger: string | null;
  readonly invalidation: string | null;
  readonly levels: TraderLevels;
  readonly riskOk: boolean;
  readonly riskNote: string;
  readonly microNote: string | null;
  readonly pipelineAge: string | null;
  readonly dataFresh: boolean;
  readonly alternate: ScanOpportunity | null;
}

const stanceFromDirection = (dir: 'LONG' | 'SHORT', ready: boolean): TraderStance =>
  ready ? dir : 'MONITOR';

const riskBlocked = (circuit: string, halted: boolean, openSlots: number): string | null => {
  if (halted) return 'Kill switch HALTED — no new risk';
  if (circuit === 'EMERGENCY' || circuit === 'HALTED') return `Circuit ${circuit} — stand down`;
  if (openSlots <= 0) return 'Max concurrent positions reached';
  return null;
};

const triggerLine = (trace: PipelineTrace, price: number): string | null => {
  const setup = topSetup(trace);
  if (!setup) {
    if (trace.outcome?.action === 'WAIT') return 'Await valid setup on next scan';
    if (trace.setups.length === 0) return 'No trigger — waiting for a qualifying setup on next scan';
    return null;
  }
  const dist = ((setup.entry - price) / price) * 100;
  const side = setup.direction === 'LONG' ? 'bid' : 'offer';
  const distLabel = Math.abs(dist) < 0.05 ? 'at market' : `${dist > 0 ? '+' : ''}${dist.toFixed(2)}% from mark`;
  return `${setup.orderType} ${setup.direction} near $${fmtPrice(setup.entry, trace.symbol)} (${distLabel}) — ${side} liquidity preferred`;
};

const microConflict = (trace: PipelineTrace): string | null => {
  const micro = trace.state?.microstructure;
  const setup = topSetup(trace);
  if (!micro || !setup) return null;
  const flow = micro.flowBias;
  if (setup.direction === 'LONG' && flow === 'SELL') {
    return `Micro flow SELL vs LONG thesis — spread ${micro.spreadBps.toFixed(1)} bps, imb ${(micro.imbalance * 100).toFixed(0)}%`;
  }
  if (setup.direction === 'SHORT' && flow === 'BUY') {
    return `Micro flow BUY vs SHORT thesis — spread ${micro.spreadBps.toFixed(1)} bps, imb ${(micro.imbalance * 100).toFixed(0)}%`;
  }
  return null;
};

/** Why zero setups fired: reuse the same regime gates the detectors were run under
 * instead of guessing "regime unclear" when the regime is in fact known. */
const noSetupReason = (trace: PipelineTrace): string => {
  const state = trace.state;
  const rejected = trace.rejectedSetup;
  if (rejected) {
    return rejected.rr > 0
      ? `Closest setup ${rejected.type} ${rejected.direction} — RR ${rejected.rr.toFixed(2)} fell short of the required hurdle`
      : `Closest setup ${rejected.type} ${rejected.direction} — stop/target structure invalid at current price`;
  }
  if (!state) return 'No valid setups — regime unclear or R:R below hurdle';
  const gates = regimeGates(state);
  if (gates.btcBlocks) return 'BTC in PANIC — long and short setups suppressed until it clears';
  if (gates.blocksLongs && gates.blocksShorts) return `${state.regime} regime — long and short setups both suppressed`;
  if (gates.blocksLongs) return `${state.regime} regime blocks longs; no qualifying short structure found`;
  if (gates.blocksShorts) return `${state.regime} regime blocks shorts; no qualifying long structure found`;
  return `${state.regime} regime — no structural setup cleared the R:R hurdle`;
};

const stanceFromTrace = (trace: PipelineTrace, riskOk: boolean): { stance: TraderStance; headline: string } => {
  if (!riskOk) return { stance: 'AVOID', headline: 'Risk envelope blocks new entries' };
  if (trace.status === 'HALTED' || trace.status === 'ERROR') {
    return { stance: 'AVOID', headline: trace.error ?? `Pipeline ${trace.status}` };
  }
  if (trace.challenge?.verdict === 'OPPOSE') {
    return { stance: 'AVOID', headline: `Risk challenger OPPOSE — ${trace.challenge.summary}` };
  }
  if (trace.risk?.approved === false) {
    return { stance: 'AVOID', headline: trace.risk.reasons.join('; ') || 'Policy gate rejected' };
  }
  if (trace.status === 'REJECTED' || trace.status === 'INVALID_PROPOSAL') {
    return { stance: 'AVOID', headline: trace.error ?? (trace.risk?.reasons.join('; ') || 'Proposal rejected') };
  }
  const setup = topSetup(trace);
  const action = trace.outcome?.action;
  if (action === 'EXIT') return { stance: 'AVOID', headline: 'Exit signal active — do not add exposure' };
  if (action === 'WAIT') return { stance: 'WAIT', headline: trace.outcome?.thesis ?? 'Stand by — no execute signal' };
  const ready = trace.status === 'APPROVED' || trace.status === 'EXECUTED';
  if (action === 'EXECUTE' && setup) {
    const s = stanceFromDirection(setup.direction, ready);
    return { stance: s, headline: ready ? `${setup.direction} approved` : `${setup.direction} candidate — pending gate` };
  }
  if (setup?.valid) return { stance: 'MONITOR', headline: `${setup.type} forming — ${setup.thesis}` };
  if (trace.setups.length === 0) return { stance: 'WAIT', headline: noSetupReason(trace) };
  return { stance: 'WAIT', headline: `Pipeline ${trace.status}` };
};

const levelsFrom = (trace: PipelineTrace): TraderLevels => {
  const setup = topSetup(trace) ?? trace.rejectedSetup;
  const analysis = trace.analysis;
  const liquidity = trace.state?.liquidity;
  return {
    support: analysis?.keyLevels.support ?? liquidity?.nearestLow,
    resistance: analysis?.keyLevels.resistance ?? liquidity?.nearestHigh,
    entry: setup?.entry,
    stop: setup?.stopLoss,
    target: setup?.takeProfit,
    rr: setup?.rr,
  };
};

const pickAlternate = (
  focus: string,
  opps: readonly ScanOpportunity[]
): ScanOpportunity | null => {
  const ranked = opps
    .filter((o) => o.symbol !== focus && (o.state === 'READY' || o.state === 'WATCH'))
    .sort((a, b) => b.confidence - a.confidence);
  return ranked[0] ?? null;
};

const buildEmptyBrief = (
  sym: string,
  opps: readonly ScanOpportunity[],
  risk: { readonly ok: boolean; readonly note: string; readonly fresh: boolean }
): TraderBrief => {
  const market = opps.find((o) => o.symbol === sym);
  return {
    symbol: sym,
    stance: 'MONITOR',
    headline: `No pipeline run yet — /pipeline ${sym}`,
    confidence: null,
    setup: null,
    regime: market?.regime ?? '—',
    mtf: market?.mtf ?? '—',
    thesis: null,
    trigger: 'Run /pipeline or wait for EventCouncil scan',
    invalidation: null,
    levels: {},
    riskOk: risk.ok,
    riskNote: risk.note,
    microNote: null,
    pipelineAge: null,
    dataFresh: risk.fresh,
    alternate: pickAlternate(sym, opps),
  };
};

const buildTraceBrief = (
  sym: string,
  trace: PipelineTrace,
  opps: readonly ScanOpportunity[],
  risk: { readonly ok: boolean; readonly block: string | null; readonly note: string; readonly fresh: boolean; readonly last: number }
): TraderBrief => {
  const { stance, headline } = stanceFromTrace(trace, risk.ok);
  const setup = topSetup(trace);
  return {
    symbol: sym,
    stance: risk.block ? 'AVOID' : stance,
    headline: risk.block ?? headline,
    confidence: trace.outcome?.confidence ?? setup?.confidence ?? null,
    setup: setup?.type ?? null,
    regime: trace.regime,
    mtf: mtfTrendLine(trace.state),
    thesis: trace.outcome?.thesis ?? setup?.thesis ?? trace.analysis?.summary
      ?? (trace.setups.length === 0 ? noSetupReason(trace) : null),
    trigger: triggerLine(trace, risk.last || setup?.entry || 0),
    invalidation: trace.outcome?.invalidation ?? setup?.invalidation ?? null,
    levels: levelsFrom(trace),
    riskOk: risk.ok,
    riskNote: risk.block ?? risk.note,
    microNote: microConflict(trace),
    pipelineAge: pipelineAge(trace.ranAt),
    dataFresh: risk.fresh,
    alternate: pickAlternate(sym, opps),
  };
};

/** Synthesize a trader-facing decision card for the focus symbol. */
export const buildTraderBrief = (
  focusSymbol: string,
  snapshots: PipelineSnapshots,
  opportunities: readonly ScanOpportunity[]
): TraderBrief => {
  const sym = focusSymbol.toUpperCase();
  const k = getKernel();
  const trace = traceForSymbol(snapshots, sym);
  const snap = k.marketStore.peekQuote(sym);
  const port = k.portfolio.peek();
  const circuit = deriveCircuitState(port.dailyLossPercent, port.drawdownPercent, port.lossStreak, k.limits);
  const slots = k.limits.maxConcurrentPositions - port.openPositions;
  const block = riskBlocked(circuit, k.killSwitch.halted, slots);
  const fresh = k.marketStore.isFresh(sym, 45_000);

  if (!trace) {
    return buildEmptyBrief(sym, opportunities, {
      ok: block === null,
      note: block ?? `Circuit ${circuit} · ${slots} slot(s) free`,
      fresh,
    });
  }

  const gatePass = trace.status === 'REJECTED' || trace.risk?.approved === false
    ? 'gate REJECTED'
    : trace.risk?.approved
    ? 'gate PASS'
    : 'gate pending';
  return buildTraceBrief(sym, trace, opportunities, {
    ok: block === null,
    block,
    note: `Circuit ${circuit} · ${slots} slot(s) · ${gatePass}`,
    fresh,
    last: snap?.last ?? snap?.mark ?? 0,
  });
};
