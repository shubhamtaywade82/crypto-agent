import type { Candle } from '../domain/market/types.js';
import { allCellStatistics, type CellStatistics } from './statistics.js';
import { checkGate, DEFAULT_GATE } from './strategy-registry.js';
import { toRecord, type SimulatedTrade } from './futures-replay.js';

/**
 * Chronological out-of-sample evaluation (V3.1 P0-4).
 *
 * TRAIN -> VALIDATE -> FREEZE -> OOS TEST: the ladder is split at a
 * time boundary; a cell is promotable ONLY when BOTH the in-sample and
 * the out-of-sample statistics pass the SAME frozen gate used by live
 * promotion. Aggregate-only promotion hides regime shifts — a strategy
 * that worked for a year and died last month must not trade.
 */

/** Frozen-gate outcome (checkGate return shape, without the cell key). */
export interface GateOutcome {
  readonly promoted: boolean;
  readonly reasons: readonly string[];
}

export interface CellOosVerdict {
  readonly cell: string;
  /** Promotable ONLY when both samples pass the same frozen gate. */
  readonly promoted: boolean;
  readonly reasons: readonly string[];
  readonly inSample: { readonly verdict: GateOutcome; readonly stats: CellStatistics };
  readonly outOfSample: { readonly verdict: GateOutcome; readonly stats: CellStatistics };
}

export interface OosEvaluation {
  readonly boundaryOpenTime: number;
  readonly isTrades: number;
  readonly oosTrades: number;
  readonly cellVerdicts: readonly CellOosVerdict[];
}

const emptyStats = (cell: string): CellStatistics => ({
  cell, n: 0, expectancyR: 0, winRate: 0, profitFactor: 0, stdDevR: 0,
  tStat: 0, worstR: 0, bestR: 0, meanMaxAdverseR: 0, meanMaxFavorableR: 0,
});

const statsByCell = (
  trades: readonly SimulatedTrade[], symbol: string
): Map<string, CellStatistics> =>
  new Map(
    allCellStatistics(trades.map((t) => toRecord(t, symbol))).map((s) => [s.cell, s])
  );

/** Split at the boundary and gate every cell on BOTH samples. */
export const evaluateOos = (
  trades: readonly SimulatedTrade[],
  base: readonly Candle[],
  oosFraction: number,
  symbol: string
): OosEvaluation => {
  const fraction = Math.min(0.9, Math.max(0.05, oosFraction));
  const boundaryIndex = Math.min(
    base.length - 1, Math.max(1, Math.floor(base.length * (1 - fraction)))
  );
  const boundaryOpenTime = base[boundaryIndex].openTime;
  const is = trades.filter((t) => t.openedAt < boundaryOpenTime);
  const oos = trades.filter((t) => t.openedAt >= boundaryOpenTime);
  const isStats = statsByCell(is, symbol);
  const oosStats = statsByCell(oos, symbol);
  const cellKeys = [...new Set([...isStats.keys(), ...oosStats.keys()])].sort();
  const cellVerdicts = cellKeys.map((cell) => {
    const isS = isStats.get(cell) ?? emptyStats(cell);
    const oosS = oosStats.get(cell) ?? emptyStats(cell);
    const isVerdict = checkGate(isS, DEFAULT_GATE);
    const oosVerdict = checkGate(oosS, DEFAULT_GATE);
    return {
      cell,
      promoted: isVerdict.promoted && oosVerdict.promoted,
      reasons: [
        ...isVerdict.reasons.map((r) => `IS: ${r}`),
        ...oosVerdict.reasons.map((r) => `OOS: ${r}`),
      ],
      inSample: { verdict: isVerdict, stats: isS },
      outOfSample: { verdict: oosVerdict, stats: oosS },
    };
  });
  return { boundaryOpenTime, isTrades: is.length, oosTrades: oos.length, cellVerdicts };
};
