import type { Candle, Timeframe } from '../domain/market/types.js';
import { TIMEFRAMES } from '../domain/market/types.js';
import { buildMtfState } from '../engines/mtf-engine.js';
import { detectSetups } from '../engines/setup-engine.js';
import type { RiskLimits } from '../domain/risk/risk-config.js';
import { allCellStatistics, type CellStatistics } from './statistics.js';
import { checkGate, DEFAULT_GATE, type PromotionVerdict } from './strategy-registry.js';
import {
  defaultReplayConfig, futuresAccounting, legacyAccounting, sizeReplayPosition,
  toRecord, type FuturesReplayConfig, type SimulatedTrade,
} from './futures-replay.js';
import {
  evaluateOos, type OosEvaluation, type CellOosVerdict, type GateOutcome,
} from './oos-evaluation.js';

/**
 * Deterministic walk-forward harness (V3.1): replays historical ladders
 * bar by bar through the DETERMINISTIC layer (structure engine -> setup
 * engine -> futures replay simulator), producing outcome records that
 * feed the SAME per-(setup x regime) statistics and pre-registered gates
 * used live. No LLM, no network — the same input always yields the same
 * dataset.
 *
 * Promotion follows TRAIN -> VALIDATE -> FREEZE -> OOS TEST (P0-4): the
 * ladder is split chronologically; a cell is promotable only when BOTH
 * the in-sample and the out-of-sample statistics pass the SAME frozen
 * gate that live promotion uses. The simulator models the real futures
 * execution surface (see futures-replay.ts, P0-3).
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
  /**
   * LEGACY flat round-trip cost in R. When set, the futures replay cost
   * model (fees/slippage/funding/sizing) is bypassed in favor of this
   * constant — kept for backward-compatible deterministic baselines.
   */
  readonly costR?: number;
  /** Futures replay surface; defaults derive from `limits`. */
  readonly replay?: Partial<FuturesReplayConfig>;
  /** Warmup: base bars consumed before the first decision. */
  readonly minBaseBars?: number;
  /** Last fraction of the ladder treated as out-of-sample (default 0.3). */
  readonly oosFraction?: number;
}

export type { FuturesReplayConfig, SimulatedTrade, OosEvaluation, CellOosVerdict, GateOutcome };

export interface WalkForwardResult {
  readonly trades: readonly SimulatedTrade[];
  readonly cells: readonly CellStatistics[];
  readonly verdicts: readonly (PromotionVerdict & { readonly stats: CellStatistics })[];
  readonly totalR: number;
  readonly oos: OosEvaluation;
  /** Decisions skipped: geometry not sizeable within the venue spec (live parity). */
  readonly skippedUnsizable: number;
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

const excursions = (
  t: { direction: 'LONG' | 'SHORT'; entry: number; stopLoss: number },
  worst: number,
  best: number
): { readonly adverse: number; readonly favorable: number } => {
  const risk = Math.abs(t.entry - t.stopLoss);
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
  /** Legacy flat cost in R (bypasses the futures cost model when set). */
  readonly costR?: number;
  readonly replay?: FuturesReplayConfig;
  /** Counts geometry-rejected decisions for harness observability. */
  readonly onUnsizable?: () => void;
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
  readonly holdingBars: number;
}

const finalize = (
  ctx: SimContext, trade: SimCandidate, decisionId: string, res: Resolution
): SimulatedTrade => {
  const ex = excursions(trade, res.worst, res.best);
  const acc = ctx.costR !== undefined
    ? legacyAccounting(trade, res, ctx.costR)
    : futuresAccounting(trade, res, ctx.replay!);
  return {
    decisionId, setupType: trade.setupType, direction: trade.direction, regime: trade.regime,
    entry: trade.entry, stopLoss: trade.stopLoss, takeProfit: trade.takeProfit,
    rMultiple: acc.rMultiple,
    maxAdverseR: Math.max(0, ex.adverse), maxFavorableR: Math.max(0, ex.favorable),
    outcome: res.outcome, openedAt: ctx.base[ctx.start].openTime, closedAt: res.closedAt,
    quantity: acc.quantity, notional: acc.notional, leverage: acc.leverage,
    riskAmount: acc.riskAmount, feesPaid: acc.feesPaid, fundingPaid: acc.fundingPaid,
    sample: 'IS', // re-tagged by the OOS split in runWalkForward
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
        holdingBars: j,
      });
    }
  }
  const exitBar = ctx.base[ctx.start + ctx.maxHoldBars] ?? ctx.base[ctx.base.length - 1];
  return finalize(ctx, trade, decisionId, {
    exit: exitBar.close, outcome: 'TIMEOUT', closedAt: exitBar.openTime, worst, best,
    holdingBars: ctx.maxHoldBars,
  });
};

/** One deterministic decision point: slice, detect, simulate. */
const decide = (
  opts: WalkForwardOptions, base: readonly Candle[], i: number, ctx: SimContext
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
  // Contract-constrained viability (mirrors the live sizer): a trade that
  // cannot be sized within the venue spec is NEVER simulated.
  if (ctx.replay && !sizeReplayPosition(ctx.replay, candidate.entry, candidate.stopLoss).ok) {
    ctx.onUnsizable?.();
    return undefined;
  }
  return simulate(
    ctx,
    {
      setupType: candidate.type, direction: candidate.direction,
      regime: mtf.state.regime, entry: candidate.entry,
      stopLoss: candidate.stopLoss, takeProfit: candidate.takeProfit,
    },
    `wf-${opts.symbol}-${base[i].openTime}`
  );
};

/** Replay the ladder bar by bar under position-concurrency constraints. */
interface GenerateArgs {
  readonly opts: WalkForwardOptions;
  readonly base: readonly Candle[];
  readonly replay: FuturesReplayConfig | undefined;
  readonly stepBars: number;
  readonly maxHoldBars: number;
  readonly minBaseBars: number;
}

interface GeneratedTrades {
  readonly trades: SimulatedTrade[];
  /** Decisions skipped because the geometry could not be sized within the venue spec. */
  readonly skippedUnsizable: number;
}

const generateTrades = (args: GenerateArgs): GeneratedTrades => {
  const { opts, base, replay, stepBars, maxHoldBars, minBaseBars } = args;
  const trades: SimulatedTrade[] = [];
  let skippedUnsizable = 0;
  const onUnsizable = (): void => {
    skippedUnsizable += 1;
  };
  /** closedAt of still-open simulated positions (concurrency slots). */
  const openUntil: number[] = [];
  for (let i = minBaseBars; i < base.length - 1; i += stepBars) {
    const now = base[i].openTime;
    while (openUntil.length > 0 && openUntil[0] <= now) openUntil.shift();
    if (openUntil.length >= (replay?.maxConcurrentPositions ?? 1)) continue;
    const trade = decide(
      opts, base, i,
      { base, start: i, maxHoldBars, costR: opts.costR, replay, onUnsizable }
    );
    if (!trade) continue;
    trades.push(trade);
    openUntil.push(trade.closedAt);
    openUntil.sort((a, b) => a - b);
  }
  return { trades, skippedUnsizable };
};

export const runWalkForward = (opts: WalkForwardOptions): WalkForwardResult => {
  const stepBars = opts.stepBars ?? 6;
  const maxHoldBars = opts.maxHoldBars ?? 60;
  const minBaseBars = opts.minBaseBars ?? 260;
  const replay = opts.costR === undefined
    ? { ...defaultReplayConfig(opts.symbol, opts.limits), ...opts.replay }
    : undefined;
  const base = opts.candles[BASE];
  const { trades, skippedUnsizable } = generateTrades({
    opts, base, replay, stepBars, maxHoldBars, minBaseBars,
  });
  const oos = evaluateOos(trades, base, opts.oosFraction ?? 0.3, opts.symbol);
  const tagged = trades.map(
    (t): SimulatedTrade =>
      t.openedAt >= oos.boundaryOpenTime ? { ...t, sample: 'OOS' } : { ...t, sample: 'IS' }
  );
  const cells = allCellStatistics(tagged.map((t) => toRecord(t, opts.symbol)));
  const verdicts = cells.map((stats) => {
    const verdict = checkGate(stats, DEFAULT_GATE);
    return { promoted: verdict.promoted, cell: stats.cell, reasons: verdict.reasons, stats };
  });
  return {
    trades: tagged, cells, verdicts,
    totalR: tagged.reduce((a, t) => a + t.rMultiple, 0),
    oos, skippedUnsizable,
  };
};

import type { IMarketDataProvider } from '../infrastructure/broker/broker.js';

/** Backfill ladders for a symbol (live provider) and run the harness. */
export const runWalkForwardFromProvider = async (
  provider: IMarketDataProvider,
  symbol: string,
  limits: RiskLimits,
  opts: { readonly btcSymbol?: string; readonly replay?: Partial<FuturesReplayConfig> } = {}
): Promise<WalkForwardResult> => {
  const btcSymbol = opts.btcSymbol ?? 'BTCUSDT';
  const backfill = async (sym: string): Promise<Record<Timeframe, readonly Candle[]>> => ({
    '5m': await provider.getKlines(sym, '5m', 1500),
    '15m': await provider.getKlines(sym, '15m', 500),
    '1h': await provider.getKlines(sym, '1h', 400),
    '4h': await provider.getKlines(sym, '4h', 300),
  });
  return runWalkForward({
    symbol,
    candles: await backfill(symbol),
    btcCandles: await backfill(btcSymbol),
    limits,
    minBaseBars: 300,
    replay: opts.replay,
  });
};
