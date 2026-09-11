import type { Candle, Timeframe, BaseEvent } from '@nemesis-oss/market-events';
import type { ComponentStudyResult, OutcomeConfig, Provenance, ResearchObservation, ResearchResult, MultipleTestingSummary } from './types.js';
import type { HtfCandlesMap } from './multi-timeframe.js';
import { calculateCausalAtr } from './causal-atr.js';
export { calculateCausalAtr };
export interface RunStudyOptions {
    readonly symbol: string;
    readonly timeframe: Timeframe;
    readonly horizonCandles?: number | undefined;
    readonly ambiguityPolicy?: 'pessimistic' | 'optimistic' | 'ambiguous' | undefined;
    readonly htfCandlesMap?: HtfCandlesMap | undefined;
}
export declare function computeDeterministicHash(input: string): string;
export declare function computeDatasetSha256(candles: readonly Candle[]): string;
export declare function createResearchObservations(events: readonly BaseEvent[], candles: readonly Candle[], config: OutcomeConfig, htfCandlesMap?: HtfCandlesMap | undefined): readonly ResearchObservation[];
export interface ObservationStudyResult {
    readonly observations: readonly ResearchObservation[];
    readonly results: readonly ComponentStudyResult[];
    readonly matchRatios: ReadonlyMap<string, number>;
    readonly multipleTesting?: MultipleTestingSummary | undefined;
}
export declare function runObservationStudy(candles: readonly Candle[], options: RunStudyOptions): ObservationStudyResult;
export declare function runUniversalStudy(candles: readonly Candle[], options: RunStudyOptions): ComponentStudyResult[];
export declare function runFvgStudy(candles: readonly Candle[], options: RunStudyOptions): ComponentStudyResult;
export declare function toResearchResult(studyResult: ComponentStudyResult, candleCount: number, provenance: Provenance, matchRatio?: number | undefined): ResearchResult;
//# sourceMappingURL=study-runner.d.ts.map