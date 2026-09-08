import type { Candle, Timeframe } from '../domain/market/types.js';
import { TIMEFRAMES } from '../domain/market/types.js';
import { buildMtfState } from '../engines/mtf-engine.js';
import { detectSetups } from '../engines/setup-engine.js';
import type { RiskLimits } from '../domain/risk/risk-config.js';
import { allCellStatistics, type CellStatistics } from './statistics.js';
import type { TradeOutcomeRecord } from './trade-ledger.js';
import { checkGate, DEFAULT_GATE, type PromotionVerdict } from './strategy-registry.js';

/**
 * Deterministic walk-forward harness: replays historical ladders bar by
 * bar through the DETERMINISTIC layer (structure engine -> setup engine ->
 * fixed-geometry simulation), producing outcome records that feed the SAME
 * per-(setup x regime) statistics and pre-registered gates used live.
 * No LLM, no network — the same input always yields the same dataset.
 */
export interface WalkForwardOptions {
  readonly symbol: string;
  readonly candles: Readonly<Record<Timeframe, readonly Candle[]>>;
  readonly btcCandles: Readonly<Record<Timeframe, readonly Candle[]>>;
  readonly limits: RiskLimits;
  /** Decision cadence on the base (5m) ladder. */
  readonly stepBars?: number;
  /** Time stop: unresolved trades close after N base bars. */
  readonly maxHoldBars?: number;
  /** Round-trip costs (fees + slippage) expressed in R. */
  readonly costR?: number;
  /** Warmup: base bars consumed before the first decision. */
  readonly minBaseBars?: number;
}

export interface SimulatedTrade {
  readonly decisionId: string;
  readonly setupType: string;
  readonly direction: 'LONG' | 'SHORT';
  readonly regime: string;
  readonly entry: number;
  readonly stopLoss: number;
  readonly takeProfit: number;
  readonly rMultiple: number;
  readonly maxAdverseR: number;
  readonly maxFavorableR: number;
  readonly outcome: 'TARGET' | 'STOP' | 'TIMEOUT';
  readonly openedAt: number;
  readonly closedAt: number;
}

export interface WalkForwardResult {
  readonly trades: readonly SimulatedTrade[];
  readonly cells: readonly CellStatistics[];
  readonly verdicts: readonly (PromotionVerdict & { readonly stats: CellStatistics })[];
  readonly totalR: number;
}

const WINDOW: Readonly<Record<Timeframe, number>> = {
  '5m': 300, '15m': 300, '1h': 300, '4h': 220,
};
const BASE: Timeframe = '5m';

const sliceAll = (
  ladder: Readonly<Record<Timeframe, readonly Candle[]>>, until: number
): Record<Timeframe, readonly Candle[]> => {
  const out = {} as Record<Timeframe, readonly Candle[]>;
  for (const tf of TIMEFRAMES) {
    const kept = ladder[tf].filter((c) => c.openTime <= until);
    out[tf] = kept.slice(Math.max(0, kept.length - WINDOW[tf]));
  }
  return out;
};

const hasHistory = (sliced: Record<Timeframe, readonly Candle[]>): boolean =>
  TIMEFRAMES.every((tf) => sliced[tf].length >= 200);

const riskPerUnit = (entry: number, stop: number): number => Math.abs(entry - stop);

const toR = (entry: number, stop: number, exit: number, direction: 'LONG' | 'SHORT'): number => {
  const risk = riskPerUnit(entry, stop);
  if (risk <= 0) return 0;
  const move = direction === 'LONG' ? exit - entry : entry - exit;
  return move / risk;
};

const excursions = (
  t: { direction: 'LONG' | 'SHORT'; entry: number; stopLoss: number },
  worst: number,
  best: number
): { readonly adverse: number; readonly favorable: number } => {
  const risk = riskPerUnit(t.entry, t.stopLoss);
  if (risk <= 0) return { adverse: 0, favorable: 0 };
  const long = t.direction === 'LONG';
  return {
    adverse: (long ? t.entry - worst : worst - t.entry) / risk,
    favorable: (long ? best - t.entry : t.entry - best) / risk,
  };
};

interface SimContext {
  readonly base: readonly Candle[];
  readonly start: number;
  readonly maxHoldBars: number;
  readonly costR: number;
}

type SimCandidate = {
  readonly setupType: string; readonly direction: 'LONG' | 'SHORT'; readonly regime: string;
  readonly entry: number; readonly stopLoss: number; readonly takeProfit: number;
};

interface Resolution {
  readonly exit: number;
  readonly outcome: 'TARGET' | 'STOP' | 'TIMEOUT';
  readonly closedAt: number;
  readonly worst: number;
  readonly best: number;
}

const finalize = (
  ctx: SimContext, trade: SimCandidate, decisionId: string, res: Resolution
): SimulatedTrade => {
  const ex = excursions(trade, res.worst, res.best);
  return {
    decisionId, setupType: trade.setupType, direction: trade.direction, regime: trade.regime,
    entry: trade.entry, stopLoss: trade.stopLoss, takeProfit: trade.takeProfit,
    rMultiple: toR(trade.entry, trade.stopLoss, res.exit, trade.direction) - ctx.costR,
    maxAdverseR: Math.max(0, ex.adverse), maxFavorableR: Math.max(0, ex.favorable),
    outcome: res.outcome, openedAt: ctx.base[ctx.start].openTime, closedAt: res.closedAt,
  };
};

/** Walk forward bar by bar; ambiguous bars (stop AND target) count as STOP. */
const simulate = (ctx: SimContext, trade: SimCandidate, decisionId: string): SimulatedTrade => {
  let worst = trade.entry;
  let best = trade.entry;
  const long = trade.direction === 'LONG';
  for (let j = 1; j <= ctx.maxHoldBars; j++) {
    const bar = ctx.base[ctx.start + j];
    if (!bar) break;
    worst = Math.min(worst, bar.low);
    best = Math.max(best, bar.high);
    const hitStop = long ? bar.low <= trade.stopLoss : bar.high >= trade.stopLoss;
    const hitTarget = long ? bar.high >= trade.takeProfit : bar.low <= trade.takeProfit;
    if (hitStop || hitTarget) {
      return finalize(ctx, trade, decisionId, {
        exit: hitStop ? trade.stopLoss : trade.takeProfit,
        outcome: hitStop ? 'STOP' : 'TARGET', closedAt: bar.openTime, worst, best,
      });
    }
  }
  const exitBar = ctx.base[ctx.start + ctx.maxHoldBars] ?? ctx.base[ctx.base.length - 1];
  return finalize(ctx, trade, decisionId, {
    exit: exitBar.close, outcome: 'TIMEOUT', closedAt: exitBar.openTime, worst, best,
  });
};

const toRecord = (t: SimulatedTrade, symbol: string): TradeOutcomeRecord => ({
  ...t,
  symbol,
  strategyId: t.setupType,
  plannedRr: riskPerUnit(t.entry, t.stopLoss) > 0
    ? Math.abs(t.takeProfit - t.entry) / riskPerUnit(t.entry, t.stopLoss)
    : 0,
  fundingRate: 0,
  leverage: 1,
  riskAmount: 1, // outcomes are expressed in R
  notional: t.entry,
  confidence: 0,
  pnl: t.rMultiple,
  holdingMinutes: 5,
  openedAt: t.openedAt,
  closedAt: t.closedAt,
});

/** One deterministic decision point: slice, detect, simulate. */
const decide = (
  opts: WalkForwardOptions, base: readonly Candle[], i: number,
  cfg: { readonly maxHoldBars: number; readonly costR: number }
): SimulatedTrade | undefined => {
  const until = base[i].openTime;
  const sliced = sliceAll(opts.candles, until);
  const btc = sliceAll(opts.btcCandles, until);
  if (!hasHistory(sliced) || !hasHistory(btc)) return undefined;
  const mtf = buildMtfState({
    symbol: opts.symbol, candles: sliced, btcCandles: btc,
    price: { last: base[i].close, mark: base[i].close, index: base[i].close },
    futures: { fundingRate: 0, openInterest: 0, openInterestChange: 0 },
  });
  const candidate = detectSetups(mtf, opts.limits)[0];
  if (!candidate) return undefined;
  return simulate(
    { base, start: i, maxHoldBars: cfg.maxHoldBars, costR: cfg.costR },
    {
      setupType: candidate.type, direction: candidate.direction,
      regime: mtf.state.regime, entry: candidate.entry,
      stopLoss: candidate.stopLoss, takeProfit: candidate.takeProfit,
    },
    `wf-${opts.symbol}-${base[i].openTime}`
  );
};

export const runWalkForward = (opts: WalkForwardOptions): WalkForwardResult => {
  const stepBars = opts.stepBars ?? 6;
  const maxHoldBars = opts.maxHoldBars ?? 60;
  const costR = opts.costR ?? 0.05;
  const minBaseBars = opts.minBaseBars ?? 260;
  const base = opts.candles[BASE];
  const trades: SimulatedTrade[] = [];
  let holdUntil = -1; // one simulated position at a time
  for (let i = minBaseBars; i < base.length - 1; i += stepBars) {
    if (i <= holdUntil) continue;
    const trade = decide(opts, base, i, { maxHoldBars, costR });
    if (!trade) continue;
    trades.push(trade);
    holdUntil = base.findIndex((c) => c.openTime >= trade.closedAt);
  }
  const cells = allCellStatistics(trades.map((t) => toRecord(t, opts.symbol)));
  const verdicts = cells.map((stats) => {
    const verdict = checkGate(stats, DEFAULT_GATE);
    return { promoted: verdict.promoted, cell: stats.cell, reasons: verdict.reasons, stats };
  });
  return { trades, cells, verdicts, totalR: trades.reduce((a, t) => a + t.rMultiple, 0) };
};

import type { IMarketDataProvider } from '../infrastructure/broker/broker.js';

/** Backfill ladders for a symbol (live provider) and run the harness. */
export const runWalkForwardFromProvider = async (
  provider: IMarketDataProvider,
  symbol: string,
  limits: RiskLimits,
  opts: { readonly btcSymbol?: string } = {}
): Promise<WalkForwardResult> => {
  const btcSymbol = opts.btcSymbol ?? 'BTCUSDT';
  const limitsFor = async (sym: string): Promise<Record<Timeframe, readonly Candle[]>> => ({
    '5m': await provider.getKlines(sym, '5m', 1500),
    '15m': await provider.getKlines(sym, '15m', 500),
    '1h': await provider.getKlines(sym, '1h', 400),
    '4h': await provider.getKlines(sym, '4h', 300),
  });
  return runWalkForward({
    symbol,
    candles: await limitsFor(symbol),
    btcCandles: await limitsFor(btcSymbol),
    limits,
    minBaseBars: 300,
  });
};
