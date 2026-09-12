import type { StrategyCandidate } from '@nemesis-oss/strategy-discovery';
/**
 * Strategy lifecycle states.
 *
 * DISCOVERED → RESEARCHED → BACKTESTED → WFO_VALIDATED → OOS_VALIDATED
 *   → PAPER → PROMOTED → ACTIVE → DEGRADED → RETIRED
 */
export type StrategyStatus = 'DISCOVERED' | 'RESEARCHED' | 'BACKTESTED' | 'WFO_VALIDATED' | 'OOS_VALIDATED' | 'PAPER' | 'PROMOTED' | 'ACTIVE' | 'DEGRADED' | 'RETIRED';
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
export declare class StrategyRegistry {
    private readonly entries;
    /** Register a new strategy candidate. */
    register(candidate: StrategyCandidate): StrategyEntry;
    /** Transition a strategy to a new status. Throws on invalid transition. */
    transition(strategyId: string, to: StrategyStatus, reason?: string): StrategyEntry;
    /** Update metrics for a strategy. */
    updateMetrics(strategyId: string, metrics: Partial<StrategyMetrics>): StrategyEntry;
    /** Get a strategy by ID. */
    get(strategyId: string): StrategyEntry | undefined;
    /** List all strategies with a given status. */
    byStatus(status: StrategyStatus): readonly StrategyEntry[];
    /** List all strategies for a given symbol. */
    bySymbol(symbol: string): readonly StrategyEntry[];
    /** List all strategies. */
    list(): readonly StrategyEntry[];
    /** Remove a strategy from the registry. */
    remove(strategyId: string): boolean;
    /** Count strategies by status. */
    countByStatus(): ReadonlyMap<StrategyStatus, number>;
}
/** Factory: create a new strategy registry. */
export declare function createStrategyRegistry(): StrategyRegistry;
//# sourceMappingURL=registry.d.ts.map