import type { TradeOutcomeRecord } from './trade-ledger.js';
import { cellOf } from './trade-ledger.js';

/**
 * Per-cell outcome statistics for the learning layer.
 *
 * A CELL is a (strategyId × regime) grouping: the smallest unit on which
 * we allow statistical claims. Expectancy in R, win rate and dispersion
 * feed the pre-registered promotion gates in `strategy-registry.ts`.
 */

export interface CellStatistics {
  readonly cell: string;
  /** Sample size — the gate for any claim made from this cell. */
  readonly n: number;
  /** Mean outcome in R units. */
  readonly expectancyR: number;
  readonly winRate: number;
  readonly profitFactor: number;
  /** Std-dev of R (population). 0 for n < 2. */
  readonly stdDevR: number;
  /** t-statistic of expectancy vs 0 (n>=2; else 0). */
  readonly tStat: number;
  readonly worstR: number;
  readonly bestR: number;
  /** Mean MAE/MFE in R — execution-quality diagnostics. */
  readonly meanMaxAdverseR: number;
  readonly meanMaxFavorableR: number;
}

const EMPTY: Omit<CellStatistics, 'cell'> = {
  n: 0, expectancyR: 0, winRate: 0, profitFactor: 0, stdDevR: 0,
  tStat: 0, worstR: 0, bestR: 0, meanMaxAdverseR: 0, meanMaxFavorableR: 0,
};

export const computeCellStatistics = (
  cell: string,
  records: readonly TradeOutcomeRecord[]
): CellStatistics => {
  if (records.length === 0) return { cell, ...EMPTY };
  const n = records.length;
  const rs = records.map((r) => r.rMultiple);
  const mean = rs.reduce((a, r) => a + r, 0) / n;
  const wins = records.filter((r) => r.pnl > 0);
  const losses = records.filter((r) => r.pnl < 0);
  const grossWin = wins.reduce((a, r) => a + r.pnl, 0);
  const grossLoss = Math.abs(losses.reduce((a, r) => a + r.pnl, 0));
  const variance = n > 1
    ? rs.reduce((a, r) => a + (r - mean) ** 2, 0) / n : 0;
  const std = Math.sqrt(variance);
  // Zero variance with a nonzero mean is infinitely significant — a
  // uniform winning (or losing) cell is the strongest signal there is.
  const tStat = std > 0
    ? mean / (std / Math.sqrt(n))
    : mean > 0 ? Number.POSITIVE_INFINITY : mean < 0 ? Number.NEGATIVE_INFINITY : 0;
  return {
    cell,
    n,
    expectancyR: mean,
    winRate: wins.length / n,
    profitFactor: grossLoss > 0 ? grossWin / grossLoss : grossWin > 0 ? Number.POSITIVE_INFINITY : 0,
    stdDevR: std,
    tStat,
    worstR: Math.min(...rs),
    bestR: Math.max(...rs),
    meanMaxAdverseR: records.reduce((a, r) => a + r.maxAdverseR, 0) / n,
    meanMaxFavorableR: records.reduce((a, r) => a + r.maxFavorableR, 0) / n,
  };
};

/** Group outcomes into cells; optional filter by strategy. */
export const groupByCell = (
  records: readonly TradeOutcomeRecord[],
  strategyId?: string
): ReadonlyMap<string, readonly TradeOutcomeRecord[]> => {
  const groups = new Map<string, TradeOutcomeRecord[]>();
  for (const r of records) {
    if (strategyId !== undefined && r.strategyId !== strategyId) continue;
    const cell = cellOf(r);
    const bucket = groups.get(cell);
    if (bucket) bucket.push(r);
    else groups.set(cell, [r]);
  }
  return groups;
};

/** Statistics for every cell (optionally scoped to one strategy). */
export const allCellStatistics = (
  records: readonly TradeOutcomeRecord[],
  strategyId?: string
): readonly CellStatistics[] =>
  [...groupByCell(records, strategyId).entries()]
    .map(([cell, group]) => computeCellStatistics(cell, group));
