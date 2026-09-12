/**
 * Valid forward transitions in the lifecycle.
 */
const VALID_TRANSITIONS = new Map([
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
 * In-memory strategy registry. Manages lifecycle transitions and
 * provides query access by status, symbol, or ID.
 *
 * Persistence is out of scope for v0.1 — the registry is ephemeral.
 * A future version will add file-based or database-backed persistence.
 */
export class StrategyRegistry {
    entries = new Map();
    /** Register a new strategy candidate. */
    register(candidate) {
        if (this.entries.has(candidate.id)) {
            throw new Error(`Strategy ${candidate.id} already registered`);
        }
        const now = Date.now();
        const entry = {
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
    transition(strategyId, to, reason) {
        const entry = this.entries.get(strategyId);
        if (!entry) {
            throw new Error(`Strategy ${strategyId} not found`);
        }
        const validNext = VALID_TRANSITIONS.get(entry.status) ?? [];
        if (!validNext.includes(to)) {
            throw new Error(`Invalid transition: ${entry.status} → ${to}. Valid: ${validNext.join(', ') || '(terminal)'}`);
        }
        const transition = {
            from: entry.status,
            to,
            at: Date.now(),
            ...(reason !== undefined ? { reason } : {}),
        };
        const updated = {
            ...entry,
            status: to,
            history: [...entry.history, transition],
            updatedAt: Date.now(),
        };
        this.entries.set(strategyId, updated);
        return updated;
    }
    /** Update metrics for a strategy. */
    updateMetrics(strategyId, metrics) {
        const entry = this.entries.get(strategyId);
        if (!entry) {
            throw new Error(`Strategy ${strategyId} not found`);
        }
        const updated = {
            ...entry,
            metrics: { ...entry.metrics, ...metrics },
            updatedAt: Date.now(),
        };
        this.entries.set(strategyId, updated);
        return updated;
    }
    /** Get a strategy by ID. */
    get(strategyId) {
        return this.entries.get(strategyId);
    }
    /** List all strategies with a given status. */
    byStatus(status) {
        return Array.from(this.entries.values()).filter((e) => e.status === status);
    }
    /** List all strategies for a given symbol. */
    bySymbol(symbol) {
        return Array.from(this.entries.values()).filter((e) => e.candidate.hypothesis.symbol === symbol);
    }
    /** List all strategies. */
    list() {
        return Array.from(this.entries.values());
    }
    /** Remove a strategy from the registry. */
    remove(strategyId) {
        return this.entries.delete(strategyId);
    }
    /** Count strategies by status. */
    countByStatus() {
        const counts = new Map();
        for (const entry of this.entries.values()) {
            counts.set(entry.status, (counts.get(entry.status) ?? 0) + 1);
        }
        return counts;
    }
}
/** Factory: create a new strategy registry. */
export function createStrategyRegistry() {
    return new StrategyRegistry();
}
//# sourceMappingURL=registry.js.map