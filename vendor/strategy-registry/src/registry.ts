import type { StrategyCandidate } from '@nemesis-oss/strategy-discovery';

/**
 * Strategy lifecycle states.
 *
 * DISCOVERED → RESEARCHED → BACKTESTED → WFO_VALIDATED → OOS_VALIDATED
 *   → PAPER → PROMOTED → ACTIVE → DEGRADED → RETIRED
 */
export type StrategyStatus =
  | 'DISCOVERED'
  | 'RESEARCHED'
  | 'BACKTESTED'
  | 'WFO_VALIDATED'
  | 'OOS_VALIDATED'
  | 'PAPER'
  | 'PROMOTED'
  | 'ACTIVE'
  | 'DEGRADED'
  | 'RETIRED';

/**
 * Valid forward transitions in the lifecycle.
 */
const VALID_TRANSITIONS: ReadonlyMap<StrategyStatus, readonly StrategyStatus[]> = new Map([
  ['DISCOVERED', ['RESEARCHED', 'RETIRED']],
  ['RESEARCHED', ['BACKTESTED', 'RETIRED']],
  ['BACKTESTED', ['WFO_VALIDATED', 'RETIRED']],
  ['WFO_VALIDATED', ['OOS_VALIDATED', 'RETIRED']],
  ['OOS_VALIDATED', ['PAPER', 'RETIRED']],
  ['PAPER', ['PROMOTED', 'RETIRED']],
  ['PROMOTED', ['ACTIVE', 'RETIRED']],
  ['ACTIVE', ['DEGRADED', 'RETIRED']],
  ['DEGRADED', ['ACTIVE', 'RETIRED']],
  ['RETIRED', []],
]);

/**
 * A strategy entry in the registry, with its current lifecycle state
 * and full history.
 */
export interface StrategyEntry {
  readonly id: string;
  readonly candidate: StrategyCandidate;
  readonly status: StrategyStatus;
  readonly history: readonly StatusTransition[];
  readonly createdAt: number;
  readonly updatedAt: number;
  /** Performance metrics tracked over time. */
  readonly metrics: StrategyMetrics;
}

export interface StatusTransition {
  readonly from: StrategyStatus;
  readonly to: StrategyStatus;
  readonly at: number;
  readonly reason?: string | undefined;
}

export interface StrategyMetrics {
  readonly liveTrades?: number | undefined;
  readonly liveWinRate?: number | undefined;
  readonly liveExpectancyR?: number | undefined;
  readonly maxDrawdown?: number | undefined;
  readonly lastTradeAt?: number | undefined;
}

/**
 * In-memory strategy registry. Manages lifecycle transitions and
 * provides query access by status, symbol, or ID.
 *
 * Persistence is out of scope for v0.1 — the registry is ephemeral.
 * A future version will add file-based or database-backed persistence.
 */
export class StrategyRegistry {
  private readonly entries = new Map<string, StrategyEntry>();

  /** Register a new strategy candidate. */
  register(candidate: StrategyCandidate): StrategyEntry {
    if (this.entries.has(candidate.id)) {
      throw new Error(`Strategy ${candidate.id} already registered`);
    }
    const now = Date.now();
    const entry: StrategyEntry = {
      id: candidate.id,
      candidate,
      status: 'DISCOVERED',
      history: [],
      createdAt: now,
      updatedAt: now,
      metrics: {},
    };
    this.entries.set(candidate.id, entry);
    return entry;
  }

  /** Transition a strategy to a new status. Throws on invalid transition. */
  transition(strategyId: string, to: StrategyStatus, reason?: string): StrategyEntry {
    const entry = this.entries.get(strategyId);
    if (!entry) {
      throw new Error(`Strategy ${strategyId} not found`);
    }
    const validNext = VALID_TRANSITIONS.get(entry.status) ?? [];
    if (!validNext.includes(to)) {
      throw new Error(
        `Invalid transition: ${entry.status} → ${to}. Valid: ${validNext.join(', ') || '(terminal)'}`,
      );
    }
    const transition: StatusTransition = {
      from: entry.status,
      to,
      at: Date.now(),
      ...(reason !== undefined ? { reason } : {}),
    };
    const updated: StrategyEntry = {
      ...entry,
      status: to,
      history: [...entry.history, transition],
      updatedAt: Date.now(),
    };
    this.entries.set(strategyId, updated);
    return updated;
  }

  /** Update metrics for a strategy. */
  updateMetrics(strategyId: string, metrics: Partial<StrategyMetrics>): StrategyEntry {
    const entry = this.entries.get(strategyId);
    if (!entry) {
      throw new Error(`Strategy ${strategyId} not found`);
    }
    const updated: StrategyEntry = {
      ...entry,
      metrics: { ...entry.metrics, ...metrics },
      updatedAt: Date.now(),
    };
    this.entries.set(strategyId, updated);
    return updated;
  }

  /** Get a strategy by ID. */
  get(strategyId: string): StrategyEntry | undefined {
    return this.entries.get(strategyId);
  }

  /** List all strategies with a given status. */
  byStatus(status: StrategyStatus): readonly StrategyEntry[] {
    return Array.from(this.entries.values()).filter((e) => e.status === status);
  }

  /** List all strategies for a given symbol. */
  bySymbol(symbol: string): readonly StrategyEntry[] {
    return Array.from(this.entries.values()).filter(
      (e) => e.candidate.hypothesis.symbol === symbol,
    );
  }

  /** List all strategies. */
  list(): readonly StrategyEntry[] {
    return Array.from(this.entries.values());
  }

  /** Remove a strategy from the registry. */
  remove(strategyId: string): boolean {
    return this.entries.delete(strategyId);
  }

  /** Count strategies by status. */
  countByStatus(): ReadonlyMap<StrategyStatus, number> {
    const counts = new Map<StrategyStatus, number>();
    for (const entry of this.entries.values()) {
      counts.set(entry.status, (counts.get(entry.status) ?? 0) + 1);
    }
    return counts;
  }
}

/** Factory: create a new strategy registry. */
export function createStrategyRegistry(): StrategyRegistry {
  return new StrategyRegistry();
}
