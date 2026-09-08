import type { EventStore } from '../infrastructure/events/event-store.js';
import type { CellStatistics } from './statistics.js';

/**
 * Strategy registry with pre-registered promotion gates (ROADMAP Phase 5).
 *
 * A rule affects live behavior ONLY after surviving the gate that was
 * declared BEFORE the outcomes were observed. Gates are frozen at
 * registration time (`strategy.registered` event) and compared against
 * per-cell statistics from the trade ledger — no post-hoc threshold
 * shopping.
 */

export type StrategyStatus = 'CANDIDATE' | 'ACTIVE' | 'RETIRED';

export interface PromotionGate {
  /** Minimum closed trades in the cell. */
  readonly minTrades: number;
  /** Minimum mean R the cell must show. */
  readonly minExpectancyR: number;
  /** Minimum win rate (0..1). */
  readonly minWinRate: number;
  /** Minimum |t| for expectancy distinguishable from zero. */
  readonly minTStat: number;
  /** No single loss worse than this R. */
  readonly maxWorstR: number;
}

export interface StrategyDefinition {
  readonly strategyId: string;
  readonly version: number;
  status: StrategyStatus;
  readonly gate: PromotionGate;
  readonly registeredAt: number;
  promotedAt?: number;
  retiredAt?: number;
  /** Cells (setup×regime) this strategy is approved to trade. */
  readonly approvedCells: readonly string[];
}

export interface PromotionVerdict {
  readonly promoted: boolean;
  readonly cell: string;
  readonly reasons: readonly string[];
}

/**
 * Pure pre-registered gate check (no strategy lookup needed). The registry
 * uses it for LIVE promotion decisions; the walk-forward harness uses it to
 * evaluate backtest cells against the SAME frozen thresholds.
 */
export const checkGate = (
  stats: {
    readonly n: number;
    readonly expectancyR: number;
    readonly winRate: number;
    readonly tStat: number;
    readonly worstR: number;
  },
  gate: PromotionGate
): { readonly promoted: boolean; readonly reasons: readonly string[] } => {
  const reasons: string[] = [];
  if (stats.n < gate.minTrades) reasons.push(`sample size ${stats.n} < ${gate.minTrades}`);
  if (stats.expectancyR < gate.minExpectancyR) {
    reasons.push(`expectancy ${stats.expectancyR.toFixed(3)}R < ${gate.minExpectancyR}R`);
  }
  if (stats.winRate < gate.minWinRate) {
    reasons.push(`win rate ${stats.winRate.toFixed(2)} < ${gate.minWinRate}`);
  }
  if (Math.abs(stats.tStat) < gate.minTStat) {
    reasons.push(`|t| ${Math.abs(stats.tStat).toFixed(2)} < ${gate.minTStat}`);
  }
  if (stats.worstR < gate.maxWorstR) {
    reasons.push(`worst trade ${stats.worstR.toFixed(2)}R beyond ${gate.maxWorstR}R floor`);
  }
  return { promoted: reasons.length === 0, reasons };
};

export const DEFAULT_GATE: PromotionGate = {
  minTrades: 30,
  minExpectancyR: 0.15,
  minWinRate: 0.4,
  minTStat: 2.0,
  maxWorstR: -3.0,
};

interface RegistryEvent {
  readonly at: number;
  readonly type: string;
  readonly payload: unknown;
}

export class StrategyRegistry {
  private readonly strategies = new Map<string, StrategyDefinition>();
  private readonly store?: EventStore;

  constructor(store?: EventStore) {
    this.store = store;
  }

  /** Rebuild from the event log (registration/promotion/retirement). */
  hydrate(events?: readonly RegistryEvent[]): void {
    const source = events ?? this.store?.readAll(5000) ?? [];
    for (const e of source) {
      const p = e.payload as Record<string, unknown>;
      if (e.type === 'strategy.registered' && typeof p?.strategyId === 'string') {
        this.strategies.set(p.strategyId, {
          strategyId: p.strategyId,
          version: typeof p.version === 'number' ? p.version : 1,
          status: 'CANDIDATE',
          gate: { ...DEFAULT_GATE, ...(p.gate as PromotionGate | undefined) },
          registeredAt: e.at,
          approvedCells: [],
        });
      } else if (e.type === 'strategy.promoted' && typeof p?.strategyId === 'string') {
        const s = this.strategies.get(p.strategyId);
        if (s) {
          s.status = 'ACTIVE';
          s.promotedAt = e.at;
        }
      } else if (e.type === 'strategy.retired' && typeof p?.strategyId === 'string') {
        const s = this.strategies.get(p.strategyId);
        if (s) {
          s.status = 'RETIRED';
          s.retiredAt = e.at;
        }
      }
    }
  }

  /**
   * Register a candidate strategy with its FROZEN promotion gate.
   * Re-registration bumps the version and resets status to CANDIDATE.
   */
  register(
    strategyId: string,
    gate: Partial<PromotionGate> = {},
    opts: { persist?: boolean } = {}
  ): StrategyDefinition {
    const previous = this.strategies.get(strategyId);
    const definition: StrategyDefinition = {
      strategyId,
      version: (previous?.version ?? 0) + 1,
      status: 'CANDIDATE',
      gate: { ...DEFAULT_GATE, ...gate },
      registeredAt: Date.now(),
      approvedCells: [],
    };
    this.strategies.set(strategyId, definition);
    if (opts.persist !== false && this.store) {
      this.store.append({
        type: 'strategy.registered',
        payload: { strategyId, version: definition.version, gate: definition.gate },
      });
    }
    return definition;
  }

  get(strategyId: string): StrategyDefinition | undefined {
    return this.strategies.get(strategyId);
  }

  all(): readonly StrategyDefinition[] {
    return [...this.strategies.values()];
  }

  /** Only strategies allowed to trade live right now. */
  active(): readonly StrategyDefinition[] {
    return this.all().filter((s) => s.status === 'ACTIVE');
  }

  /**
   * Evaluate a cell's statistics against the strategy's frozen gate.
   * Returns the verdict with explicit reasons — auditable, never silent.
   */
  evaluateAgainstGate(
    strategyId: string,
    cell: string,
    stats: CellStatistics
  ): PromotionVerdict {
    const s = this.strategies.get(strategyId);
    if (!s) return { promoted: false, cell, reasons: ['strategy not registered'] };
    if (s.status === 'RETIRED') {
      return { promoted: false, cell, reasons: ['strategy retired'] };
    }
    const g = s.gate;
    const reasons: string[] = [];
    if (stats.n < g.minTrades) {
      reasons.push(`sample size ${stats.n} < ${g.minTrades}`);
    }
    if (stats.expectancyR < g.minExpectancyR) {
      reasons.push(`expectancy ${stats.expectancyR.toFixed(3)}R < ${g.minExpectancyR}R`);
    }
    if (stats.winRate < g.minWinRate) {
      reasons.push(`win rate ${stats.winRate.toFixed(2)} < ${g.minWinRate}`);
    }
    if (Math.abs(stats.tStat) < g.minTStat) {
      reasons.push(`|t| ${Math.abs(stats.tStat).toFixed(2)} < ${g.minTStat}`);
    }
    if (stats.worstR < g.maxWorstR) {
      reasons.push(`worst trade ${stats.worstR.toFixed(2)}R beyond ${g.maxWorstR}R floor`);
    }
    return { promoted: reasons.length === 0, cell, reasons };
  }

  /** Promote on a passing gate; persists the decision with reasons. */
  promote(
    strategyId: string,
    cell: string,
    stats: CellStatistics,
    opts: { force?: boolean } = {}
  ): PromotionVerdict {
    const verdict = this.evaluateAgainstGate(strategyId, cell, stats);
    if (!verdict.promoted && !opts.force) return verdict;
    const s = this.strategies.get(strategyId);
    if (!s) return verdict;
    s.status = 'ACTIVE';
    s.promotedAt = Date.now();
    this.strategies.set(strategyId, s);
    if (this.store) {
      this.store.append({
        type: 'strategy.promoted',
        payload: { strategyId, cell, stats: { n: stats.n, expectancyR: stats.expectancyR } },
      });
    }
    return verdict;
  }

  /** Retire a strategy (manual or drift-triggered). */
  retire(strategyId: string, reason: string): void {
    const s = this.strategies.get(strategyId);
    if (!s) return;
    s.status = 'RETIRED';
    s.retiredAt = Date.now();
    if (this.store) {
      this.store.append({ type: 'strategy.retired', payload: { strategyId, reason } });
    }
  }
}
