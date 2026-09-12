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
export class ResearchMemory {
  private readonly experiments = new Map<string, ExperimentRecord>();
  private readonly datasets = new Map<string, DatasetRecord>();
  private readonly strategies = new Map<string, StrategyCandidate>();
  private readonly hypothesisIndex = new Map<string, Set<string>>(); // key → experiment IDs

  /** Store an experiment result. */
  recordExperiment(record: ExperimentRecord): void {
    this.experiments.set(record.id, record);
    const key = this.hypothesisKey(record.hypothesis);
    const set = this.hypothesisIndex.get(key) ?? new Set<string>();
    set.add(record.id);
    this.hypothesisIndex.set(key, set);
  }

  /** Store a dataset record. */
  recordDataset(dataset: DatasetRecord): void {
    this.datasets.set(dataset.id, dataset);
  }

  /** Store a strategy candidate. */
  recordStrategy(strategy: StrategyCandidate): void {
    this.strategies.set(strategy.id, strategy);
  }

  /**
   * Check if a hypothesis has been tested before.
   * Returns the previous result if found, null otherwise.
   */
  findPriorTest(hypothesis: Hypothesis): ExperimentRecord | null {
    const key = this.hypothesisKey(hypothesis);
    const ids = this.hypothesisIndex.get(key);
    if (!ids || ids.size === 0) return null;
    // Return the most recent.
    const sorted = Array.from(ids)
      .map((id) => this.experiments.get(id)!)
      .filter(Boolean)
      .sort((a, b) => b.createdAt - a.createdAt);
    return sorted[0] ?? null;
  }

  /** List all experiments for a symbol. */
  experimentsBySymbol(symbol: string): readonly ExperimentRecord[] {
    return Array.from(this.experiments.values()).filter(
      (e) => e.hypothesis.symbol === symbol,
    );
  }

  /** List all experiments for an event type. */
  experimentsByEventType(eventType: string): readonly ExperimentRecord[] {
    return Array.from(this.experiments.values()).filter(
      (e) => e.hypothesis.eventType === eventType,
    );
  }

  /** List all validated strategies. */
  validatedStrategies(): readonly StrategyCandidate[] {
    return Array.from(this.strategies.values()).filter(
      (s) => s.result.verdict === 'validated',
    );
  }

  /** List all rejected hypotheses (negative results). */
  rejectedExperiments(): readonly ExperimentRecord[] {
    return Array.from(this.experiments.values()).filter(
      (e) => e.result.verdict === 'rejected',
    );
  }

  /** Get a dataset by ID. */
  getDataset(id: string): DatasetRecord | undefined {
    return this.datasets.get(id);
  }

  /** Find a dataset by symbol + timeframe + hash. */
  findDataset(symbol: string, timeframe: string, hash: string): DatasetRecord | undefined {
    return Array.from(this.datasets.values()).find(
      (d) => d.symbol === symbol && d.timeframe === timeframe && d.hash === hash,
    );
  }

  /** List all datasets. */
  listDatasets(): readonly DatasetRecord[] {
    return Array.from(this.datasets.values());
  }

  /** Clear all memory. */
  clear(): void {
    this.experiments.clear();
    this.datasets.clear();
    this.strategies.clear();
    this.hypothesisIndex.clear();
  }

  /** Total experiment count. */
  get experimentCount(): number {
    return this.experiments.size;
  }

  /** Total strategy count. */
  get strategyCount(): number {
    return this.strategies.size;
  }

  /** Build a stable key for hypothesis deduplication. */
  private hypothesisKey(h: Hypothesis): string {
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
export function createResearchMemory(): ResearchMemory {
  return new ResearchMemory();
}

/**
 * Generate a deterministic dataset hash from candle data.
 * Useful for deduplication: if the same dataset is loaded twice,
 * the hash matches and prior experiments can be reused.
 */
export function computeDatasetHash(
  symbol: string,
  timeframe: string,
  candleCount: number,
  startTime: number,
  endTime: number,
): string {
  const input = `${symbol}:${timeframe}:${candleCount}:${startTime}:${endTime}`;
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    hash = ((hash << 5) - hash + input.charCodeAt(i)!) | 0;
  }
  return `ds-${Math.abs(hash).toString(16)}`;
}
