import type { TradeOutcomeRecord } from './trade-ledger.js';
import { computeCellStatistics } from './statistics.js';

/**
 * Portfolio-level performance analytics for the learning layer.
 *
 * The PerformanceEngine stays the risk-governor's live ledger (daily PnL,
 * streaks, drawdown); this module derives the REPORTING statistics from
 * the trade ledger's attributed outcomes: full summary metrics, Sharpe /
 * Sortino over the daily-return series, and segmentation by strategy,
 * symbol and regime.
 */

export interface PerformanceSummary {
  readonly tradeCount: number;
  readonly realizedPnl: number;
  readonly winRate: number;
  readonly profitFactor: number;
  /** Mean outcome in R units. */
  readonly expectancyR: number;
  readonly avgHoldingMinutes: number;
  readonly avgMaxAdverseR: number;
  readonly avgMaxFavorableR: number;
  /** Annualized Sharpe over daily returns (0 when undefined). */
  readonly sharpe: number;
  /** Annualized Sortino over daily returns (0 when undefined). */
  readonly sortino: number;
}

export interface SegmentReport {
  readonly key: string;
  readonly trades: number;
  readonly realizedPnl: number;
  readonly winRate: number;
  readonly expectancyR: number;
}

const utcDay = (at: number): number => Math.floor(at / 86_400_000);

/** Aggregate a set of outcomes into one segment report. */
export const segmentReport = (
  key: string,
  records: readonly TradeOutcomeRecord[]
): SegmentReport => {
  const wins = records.filter((r) => r.pnl > 0);
  return {
    key,
    trades: records.length,
    realizedPnl: records.reduce((a, r) => a + r.pnl, 0),
    winRate: records.length > 0 ? wins.length / records.length : 0,
    expectancyR: records.length > 0
      ? records.reduce((a, r) => a + r.rMultiple, 0) / records.length : 0,
  };
};

/** Group outcomes by an arbitrary key function. */
export const segmentBy = (
  records: readonly TradeOutcomeRecord[],
  keyOf: (r: TradeOutcomeRecord) => string
): readonly SegmentReport[] => {
  const groups = new Map<string, TradeOutcomeRecord[]>();
  for (const r of records) {
    const k = keyOf(r);
    const bucket = groups.get(k);
    if (bucket) bucket.push(r);
    else groups.set(k, [r]);
  }
  return [...groups.entries()]
    .map(([key, group]) => segmentReport(key, group))
    .sort((a, b) => b.realizedPnl - a.realizedPnl);
};

export const summarize = (records: readonly TradeOutcomeRecord[]): PerformanceSummary => {
  const n = records.length;
  if (n === 0) {
    return {
      tradeCount: 0, realizedPnl: 0, winRate: 0, profitFactor: 0, expectancyR: 0,
      avgHoldingMinutes: 0, avgMaxAdverseR: 0, avgMaxFavorableR: 0, sharpe: 0, sortino: 0,
    };
  }
  const wins = records.filter((r) => r.pnl > 0);
  const losses = records.filter((r) => r.pnl < 0);
  const grossWin = wins.reduce((a, r) => a + r.pnl, 0);
  const grossLoss = Math.abs(losses.reduce((a, r) => a + r.pnl, 0));
  const daily = dailyReturnSeries(records);
  return {
    tradeCount: n,
    realizedPnl: records.reduce((a, r) => a + r.pnl, 0),
    winRate: wins.length / n,
    profitFactor: grossLoss > 0 ? grossWin / grossLoss : grossWin > 0 ? Number.POSITIVE_INFINITY : 0,
    expectancyR: records.reduce((a, r) => a + r.rMultiple, 0) / n,
    avgHoldingMinutes: records.reduce((a, r) => a + r.holdingMinutes, 0) / n,
    avgMaxAdverseR: records.reduce((a, r) => a + r.maxAdverseR, 0) / n,
    avgMaxFavorableR: records.reduce((a, r) => a + r.maxFavorableR, 0) / n,
    sharpe: sharpeRatio(daily),
    sortino: sortinoRatio(daily),
  };
};

/**
 * Daily returns derived from R outcomes: per UTC day, mean R per trade
 * (R is the normalized return unit of the system). Empty days vanish —
 * the series only contains days that realized something.
 */
export const dailyReturnSeries = (
  records: readonly TradeOutcomeRecord[]
): readonly number[] => {
  const byDay = new Map<number, { sum: number; n: number }>();
  for (const r of records) {
    const day = utcDay(r.closedAt);
    const cur = byDay.get(day) ?? { sum: 0, n: 0 };
    cur.sum += r.rMultiple;
    cur.n += 1;
    byDay.set(day, cur);
  }
  return [...byDay.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, d]) => d.sum / d.n);
};

/** Sharpe over the daily return series, annualized with sqrt(365). */
export const sharpeRatio = (returns: readonly number[]): number => {
  const n = returns.length;
  if (n < 2) return 0;
  const mean = returns.reduce((a, r) => a + r, 0) / n;
  const variance = returns.reduce((a, r) => a + (r - mean) ** 2, 0) / (n - 1);
  if (variance <= 0) return mean > 0 ? Number.POSITIVE_INFINITY : 0;
  return (mean / Math.sqrt(variance)) * Math.sqrt(365);
};

/** Sortino: like Sharpe but only downside dispersion counts. */
export const sortinoRatio = (returns: readonly number[]): number => {
  const n = returns.length;
  if (n < 2) return 0;
  const mean = returns.reduce((a, r) => a + r, 0) / n;
  const downside = returns.filter((r) => r < 0);
  if (downside.length === 0) return mean > 0 ? Number.POSITIVE_INFINITY : 0;
  const downsideDev = Math.sqrt(
    downside.reduce((a, r) => a + r * r, 0) / n
  );
  if (downsideDev <= 0) return 0;
  return (mean / downsideDev) * Math.sqrt(365);
};

/** Full analytics snapshot: summary + every useful segmentation. */
export const analyticsSnapshot = (records: readonly TradeOutcomeRecord[]): {
  readonly summary: PerformanceSummary;
  readonly byStrategy: readonly SegmentReport[];
  readonly bySymbol: readonly SegmentReport[];
  readonly byRegime: readonly SegmentReport[];
  readonly cells: ReturnType<typeof computeCellStatistics>[];
} => {
  const cells = [...new Set(records.map((r) => `${r.strategyId}|${r.regime}`))]
    .map((cell) => computeCellStatistics(cell,
      records.filter((r) => `${r.strategyId}|${r.regime}` === cell)));
  return {
    summary: summarize(records),
    byStrategy: segmentBy(records, (r) => r.strategyId),
    bySymbol: segmentBy(records, (r) => r.symbol),
    byRegime: segmentBy(records, (r) => r.regime),
    cells,
  };
};
