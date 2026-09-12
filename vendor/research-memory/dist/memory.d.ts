import type { Hypothesis, HypothesisResult } from '@nemesis-oss/hypothesis-engine';
import type { StrategyCandidate } from '@nemesis-oss/strategy-discovery';
/**
 * A stored experiment record: hypothesis + result + metadata.
 */
export interface ExperimentRecord {
    readonly id: string;
    readonly hypothesis: Hypothesis;
    readonly result: HypothesisResult;
    readonly datasetHash?: string | undefined;
    readonly createdAt: number;
}
/**
 * A stored dataset record.
 */
export interface DatasetRecord {
    readonly id: string;
    readonly symbol: string;
    readonly timeframe: string;
    readonly candleCount: number;
    readonly startTime: number;
    readonly endTime: number;
    readonly hash: string;
    readonly createdAt: number;
}
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
export declare class ResearchMemory {
    private readonly experiments;
    private readonly datasets;
    private readonly strategies;
    private readonly hypothesisIndex;
    /** Store an experiment result. */
    recordExperiment(record: ExperimentRecord): void;
    /** Store a dataset record. */
    recordDataset(dataset: DatasetRecord): void;
    /** Store a strategy candidate. */
    recordStrategy(strategy: StrategyCandidate): void;
    /**
     * Check if a hypothesis has been tested before.
     * Returns the previous result if found, null otherwise.
     */
    findPriorTest(hypothesis: Hypothesis): ExperimentRecord | null;
    /** List all experiments for a symbol. */
    experimentsBySymbol(symbol: string): readonly ExperimentRecord[];
    /** List all experiments for an event type. */
    experimentsByEventType(eventType: string): readonly ExperimentRecord[];
    /** List all validated strategies. */
    validatedStrategies(): readonly StrategyCandidate[];
    /** List all rejected hypotheses (negative results). */
    rejectedExperiments(): readonly ExperimentRecord[];
    /** Get a dataset by ID. */
    getDataset(id: string): DatasetRecord | undefined;
    /** Find a dataset by symbol + timeframe + hash. */
    findDataset(symbol: string, timeframe: string, hash: string): DatasetRecord | undefined;
    /** List all datasets. */
    listDatasets(): readonly DatasetRecord[];
    /** Clear all memory. */
    clear(): void;
    /** Total experiment count. */
    get experimentCount(): number;
    /** Total strategy count. */
    get strategyCount(): number;
    /** Build a stable key for hypothesis deduplication. */
    private hypothesisKey;
}
/** Factory: create a new research memory. */
export declare function createResearchMemory(): ResearchMemory;
/**
 * Generate a deterministic dataset hash from candle data.
 * Useful for deduplication: if the same dataset is loaded twice,
 * the hash matches and prior experiments can be reused.
 */
export declare function computeDatasetHash(symbol: string, timeframe: string, candleCount: number, startTime: number, endTime: number): string;
//# sourceMappingURL=memory.d.ts.map