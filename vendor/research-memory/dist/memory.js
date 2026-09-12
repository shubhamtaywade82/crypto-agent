/**
 * Research memory: persistent domain knowledge across runs.
 *
 * Allows the agent to reason:
 *   "I already tested bullish FVG + BOS on SOLUSDT 15m in 2025 and the
 *    edge disappeared OOS."
 *
 * Instead of rediscovering the same hypothesis every time.
 *
 * v0.1 is in-memory only. A future version will add file-based or
 * database-backed persistence.
 */
export class ResearchMemory {
    experiments = new Map();
    datasets = new Map();
    strategies = new Map();
    hypothesisIndex = new Map(); // key → experiment IDs
    /** Store an experiment result. */
    recordExperiment(record) {
        this.experiments.set(record.id, record);
        const key = this.hypothesisKey(record.hypothesis);
        const set = this.hypothesisIndex.get(key) ?? new Set();
        set.add(record.id);
        this.hypothesisIndex.set(key, set);
    }
    /** Store a dataset record. */
    recordDataset(dataset) {
        this.datasets.set(dataset.id, dataset);
    }
    /** Store a strategy candidate. */
    recordStrategy(strategy) {
        this.strategies.set(strategy.id, strategy);
    }
    /**
     * Check if a hypothesis has been tested before.
     * Returns the previous result if found, null otherwise.
     */
    findPriorTest(hypothesis) {
        const key = this.hypothesisKey(hypothesis);
        const ids = this.hypothesisIndex.get(key);
        if (!ids || ids.size === 0)
            return null;
        // Return the most recent.
        const sorted = Array.from(ids)
            .map((id) => this.experiments.get(id))
            .filter(Boolean)
            .sort((a, b) => b.createdAt - a.createdAt);
        return sorted[0] ?? null;
    }
    /** List all experiments for a symbol. */
    experimentsBySymbol(symbol) {
        return Array.from(this.experiments.values()).filter((e) => e.hypothesis.symbol === symbol);
    }
    /** List all experiments for an event type. */
    experimentsByEventType(eventType) {
        return Array.from(this.experiments.values()).filter((e) => e.hypothesis.eventType === eventType);
    }
    /** List all validated strategies. */
    validatedStrategies() {
        return Array.from(this.strategies.values()).filter((s) => s.result.verdict === 'validated');
    }
    /** List all rejected hypotheses (negative results). */
    rejectedExperiments() {
        return Array.from(this.experiments.values()).filter((e) => e.result.verdict === 'rejected');
    }
    /** Get a dataset by ID. */
    getDataset(id) {
        return this.datasets.get(id);
    }
    /** Find a dataset by symbol + timeframe + hash. */
    findDataset(symbol, timeframe, hash) {
        return Array.from(this.datasets.values()).find((d) => d.symbol === symbol && d.timeframe === timeframe && d.hash === hash);
    }
    /** List all datasets. */
    listDatasets() {
        return Array.from(this.datasets.values());
    }
    /** Clear all memory. */
    clear() {
        this.experiments.clear();
        this.datasets.clear();
        this.strategies.clear();
        this.hypothesisIndex.clear();
    }
    /** Total experiment count. */
    get experimentCount() {
        return this.experiments.size;
    }
    /** Total strategy count. */
    get strategyCount() {
        return this.strategies.size;
    }
    /** Build a stable key for hypothesis deduplication. */
    hypothesisKey(h) {
        return [
            h.symbol,
            h.timeframe,
            h.eventType,
            h.targetMetric ?? 'hit2R',
            h.regimeFilter?.trend ?? '',
            h.regimeFilter?.volatility ?? '',
            h.minDisplacementAtr ?? '',
            h.requirePriorSweep ? 'sweep' : '',
            h.horizonCandles ?? 24,
        ].join('|');
    }
}
/** Factory: create a new research memory. */
export function createResearchMemory() {
    return new ResearchMemory();
}
/**
 * Generate a deterministic dataset hash from candle data.
 * Useful for deduplication: if the same dataset is loaded twice,
 * the hash matches and prior experiments can be reused.
 */
export function computeDatasetHash(symbol, timeframe, candleCount, startTime, endTime) {
    const input = `${symbol}:${timeframe}:${candleCount}:${startTime}:${endTime}`;
    let hash = 0;
    for (let i = 0; i < input.length; i++) {
        hash = ((hash << 5) - hash + input.charCodeAt(i)) | 0;
    }
    return `ds-${Math.abs(hash).toString(16)}`;
}
//# sourceMappingURL=memory.js.map