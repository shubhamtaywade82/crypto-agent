import { getKernel } from '../kernel.js';
import type { StrategyStatus } from '../learning/strategy-registry.js';
import { allCellStatistics, computeCellStatistics } from '../learning/statistics.js';
import type { TradeOutcomeRecord } from '../learning/trade-ledger.js';
import type { SetupType } from '../engines/setup-engine.js';

export interface StrategyRow {
  readonly id: string;
  readonly status: StrategyStatus | 'DETECTOR';
  readonly version: string;
  readonly cells: number;
  readonly trades: number;
  readonly expectancy: string;
  readonly pf: number;
  readonly detail: string;
  readonly approvedCells: readonly string[];
}

const KERNEL_SETUPS: readonly SetupType[] = [
  'PULLBACK_RECLAIM',
  'LIQUIDITY_SWEEP_REVERSAL',
  'BREAKOUT_RETEST',
  'TREND_CONTINUATION',
];

const fmtR = (r: number): string => `${r >= 0 ? '+' : ''}${r.toFixed(2)}R`;

const aggregatePf = (records: readonly { pnl: number }[]): number => {
  const wins = records.filter((r) => r.pnl > 0).reduce((a, r) => a + r.pnl, 0);
  const losses = Math.abs(records.filter((r) => r.pnl < 0).reduce((a, r) => a + r.pnl, 0));
  if (losses > 0) return wins / losses;
  return wins > 0 ? 99 : 0;
};

interface RowBuildInput {
  readonly id: string;
  readonly status: StrategyRow['status'];
  readonly version: string;
  readonly approvedCells: readonly string[];
  readonly outcomes: readonly TradeOutcomeRecord[];
}

const rowFromOutcomes = (
  input: RowBuildInput,
  ledger: ReturnType<typeof getKernel>['ledger']
): StrategyRow => {
  const { id, status, version, approvedCells, outcomes } = input;
  const n = outcomes.length;
  const meanR = n > 0 ? outcomes.reduce((a, o) => a + o.rMultiple, 0) / n : 0;
  const cells = approvedCells.length > 0 ? approvedCells.length : allCellStatistics(outcomes, id).length;
  const cellStats = approvedCells.map((c) => computeCellStatistics(c, ledger.outcomesForCell(c)));
  const best = cellStats.sort((a, b) => b.expectancyR - a.expectancyR)[0];
  const detail = best && best.n > 0
    ? `top cell ${best.cell} n=${best.n} E=${fmtR(best.expectancyR)} t=${best.tStat.toFixed(2)}`
    : n > 0 ? `${n} closed trades in ledger` : 'awaiting closed trades for cell stats';
  return {
    id,
    status,
    version,
    cells: status === 'DETECTOR' ? 0 : cells,
    trades: n,
    expectancy: n > 0 ? fmtR(meanR) : '—',
    pf: n > 0 ? aggregatePf(outcomes) : 0,
    detail,
    approvedCells,
  };
};

/** Build strategy table rows from registry + ledger (honest empty states). */
export const buildStrategyRows = (): StrategyRow[] => {
  const k = getKernel();
  const defs = k.strategies.all();
  if (defs.length > 0) {
    return defs.map((d) => rowFromOutcomes({
      id: d.strategyId,
      status: d.status,
      version: `v${d.version}`,
      approvedCells: d.approvedCells,
      outcomes: k.ledger.outcomes.filter((o) => o.strategyId === d.strategyId),
    }, k.ledger));
  }
  return KERNEL_SETUPS.map((setup) => {
    const outcomes = k.ledger.outcomes.filter((o) => o.strategyId === setup);
    const promoted = allCellStatistics(outcomes, setup).filter((s) => s.n >= 30 && s.expectancyR >= 0.15);
    return rowFromOutcomes({
      id: setup.toLowerCase(),
      status: promoted.length > 0 ? 'CANDIDATE' : 'DETECTOR',
      version: 'kernel',
      approvedCells: promoted.map((s) => s.cell),
      outcomes,
    }, k.ledger);
  });
};
