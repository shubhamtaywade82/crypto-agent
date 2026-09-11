import { Decimal } from 'decimal.js';
import type { BaseEvent, Timeframe } from '@nemesis-oss/market-events';

export interface Provenance {
  readonly datasetId: string;
  readonly datasetHash: string;
  readonly detectorId: string;
  readonly detectorVersion: string;
  readonly detectorConfigHash: string;
  readonly outcomeConfigHash: string;
  readonly outcomeVersion: string;
}

export type FirstHitResult = 'target_first' | 'stop_first' | 'simultaneous_collision' | 'horizon_expired';
export type AmbiguityPolicy = 'pessimistic' | 'optimistic' | 'ambiguous';

export interface OutcomeLabel {
  readonly startIndex: number; readonly endIndex: number;
  readonly startTimestamp: number; readonly endTimestamp: number;
}

export interface OutcomeConfig {
  readonly horizonCandles: number;
  readonly targetR: number;
  readonly stopAtrMultiplier: number;
  readonly ambiguityPolicy: AmbiguityPolicy;
}

export type PathResolution =
  | 'single_bar_unambiguous' | 'ohlc_resolved' | 'ohlc_collision'
  | 'lower_tf_resolved' | 'tick_resolved' | 'ohlc_pessimistic' | 'ohlc_optimistic'
  | 'ambiguous' | 'exact';

export interface TradeOutcome {
  readonly entryPrice: Decimal; readonly exitPrice: Decimal;
  readonly exitReason: 'target' | 'stop' | 'horizon_expired' | 'invalidation';
  readonly realizedR: Decimal; readonly realizedPnl?: Decimal | undefined;
  readonly wonTrade: boolean; readonly barsHeld: number;
}

export type TradeExecutionOutcome = TradeOutcome;

export interface OutcomeDefinition {
  readonly measurementAnchor: 'origin_close' | 'available_close' | 'zone_boundary' | 'extreme_level';
  readonly entryReference: string;
  readonly riskReference: 'causal_atr' | 'zone_span' | 'fixed_ticks' | 'swing_extreme';
  readonly targetDefinition: string;
  readonly stopDefinition: string;
  readonly invalidationDefinition?: string | undefined;
}

export interface BaseOutcome {
  readonly eventId: string;
  readonly horizonCandles: number;
  readonly label?: OutcomeLabel | undefined;
  readonly mfe: Decimal;
  readonly mae: Decimal;
  readonly mfeAtr: Decimal; readonly maeAtr: Decimal;
  readonly mfeR: Decimal; readonly maeR: Decimal;
  readonly targetHitR: Decimal;
  /** @deprecated Realized R belongs strictly to TradeOutcome */
  readonly realizedR?: Decimal | undefined;
  readonly firstHit: FirstHitResult;
  readonly timeToFirstHitBars: number;
  readonly isAmbiguous: boolean;
  readonly pathResolution: PathResolution;
  readonly collision: boolean;
  readonly targetFirst: boolean; readonly stopFirst: boolean; readonly stopHit: boolean;
  readonly timeToTarget: number | null; readonly timeToStop: number | null;
  readonly targetHit1R: boolean; readonly targetHit2R: boolean; readonly targetHit3R: boolean;
  readonly reached1R: boolean; readonly reached2R: boolean; readonly reached3R: boolean;
  readonly timeTo1R?: number | null | undefined;
  readonly timeTo2R?: number | null | undefined;
  readonly timeTo3R?: number | null | undefined;
  /** @deprecated Alias for reached1R */
  readonly hit1R: boolean;
  /** @deprecated Alias for reached2R */
  readonly hit2R: boolean;
  /** @deprecated Alias for reached3R */
  readonly hit3R: boolean;
}

export type MarketOutcome = BaseOutcome;

export interface DirectionalOutcome extends BaseOutcome {}

export interface FvgOutcome extends BaseOutcome {
  readonly firstTouchBars: number | null;
  readonly firstTouchIndex: number | null;
  readonly fill25: boolean;
  readonly fill50: boolean;
  readonly fill75: boolean;
  readonly fill100: boolean;
  readonly isMitigated: boolean;
  readonly isInvalidated: boolean;
}

export interface OrderBlockOutcome extends BaseOutcome {
  readonly firstTouchBars: number | null;
  readonly maxPenetrationRatio: Decimal;
  readonly isMitigated: boolean;
  readonly isBreaker: boolean;
}

export interface StructureOutcome extends BaseOutcome {
  readonly hasRetested: boolean;
  readonly retestBars: number | null;
  readonly isContinuation: boolean;
  readonly nextBreakBars: number | null;
}

export interface LiquiditySweepOutcome extends BaseOutcome {
  readonly isReclaimed: boolean;
  readonly reclaimBars: number | null;
  readonly postSweepDisplacementAtr: Decimal;
  readonly oppositeLiquidityTaken: boolean;
}

// Backward-compatibility alias for zone outcome
export interface ZoneOutcome extends FvgOutcome {
  readonly firstTouchIndex: number | null;
  readonly touch25: boolean;
  readonly touch50: boolean;
  readonly touch75: boolean;
  readonly fullFill: boolean;
}

export type EventOutcome =
  | DirectionalOutcome | FvgOutcome | OrderBlockOutcome
  | StructureOutcome | LiquiditySweepOutcome | ZoneOutcome;

export interface BootstrapConfidenceInterval {
  readonly lower: number;
  readonly upper: number;
  readonly pointEstimate: number;
  readonly standardError: number;
}

export interface ComponentStudyResult {
  readonly symbol: string;
  readonly timeframe: Timeframe;
  readonly eventType: string;
  readonly sampleSize: number;
  readonly effectiveSampleSize?: number | undefined;
  readonly clusterCount?: number | undefined;
  readonly retestProbability: number | null;
  readonly fill25Rate: number | null;
  readonly fill50Rate: number | null;
  readonly fullFillRate: number | null;
  readonly medianMfeAtr: number;
  readonly medianMaeAtr: number;
  readonly reachRates: { readonly r1: number; readonly r2: number; readonly r3: number };
  /** @deprecated Use reachRates */
  readonly hitRates: { readonly r1: number; readonly r2: number; readonly r3: number };
  readonly confidenceIntervalR2?: { readonly lower: number; readonly upper: number } | undefined;
  readonly medianMfeAtrCi?: BootstrapConfidenceInterval | undefined;
  readonly baselineComparisonR2?: {
    readonly baselineProbability: number;
    readonly uplift: number;
    readonly isStatisticallySignificant: boolean;
    readonly pValueEstimate: number;
    readonly adjustedPValue?: number | undefined;
    readonly isFdrSignificant?: boolean | undefined;
    readonly oddsRatio?: number | undefined;
    readonly relativeUplift?: number | undefined;
  } | undefined;
}

export interface MultipleTestingSummary {
  readonly procedure: 'benjamini_hochberg' | 'holm_bonferroni';
  readonly alpha: number;
  readonly totalTests: number;
  readonly significantCount: number;
}

export interface ResearchPopulationInfo {
  readonly symbol: string;
  readonly timeframe: Timeframe;
  readonly candleCount: number;
}

export interface ResearchSampleInfo {
  readonly eventType: string;
  readonly sampleSize: number;
  readonly effectiveSampleSize: number;
  readonly clusterCount: number;
}

export interface ResearchControlsInfo {
  readonly sampleSize: number;
  readonly matchedHitRateR2: number;
  readonly matchRatio: number;
}

export interface ResearchDescriptiveStats {
  readonly reachRates: { readonly r1: number; readonly r2: number; readonly r3: number };
  /** @deprecated Use reachRates */
  readonly hitRates: { readonly r1: number; readonly r2: number; readonly r3: number };
  readonly medianMfeAtr: number;
  readonly medianMaeAtr: number;
  readonly retestProbability: number | null;
  readonly fill25Rate: number | null;
  readonly fill50Rate: number | null;
  readonly fullFillRate: number | null;
}

export interface ResearchEffectStats {
  readonly uplift: number;
  readonly relativeUplift?: number | undefined;
  readonly oddsRatio?: number | undefined;
}

export interface ResearchUncertaintyStats {
  readonly confidenceIntervalR2?: { readonly lower: number; readonly upper: number } | undefined;
  readonly medianMfeAtrCi?: BootstrapConfidenceInterval | undefined;
}

export interface ResearchDependenceStats {
  readonly clusterCount: number;
  readonly effectiveSampleSize: number;
  readonly pValueEstimate: number;
  readonly isStatisticallySignificant: boolean;
  readonly adjustedPValue?: number | undefined;
  readonly isFdrSignificant?: boolean | undefined;
}

export type EvidenceStatus =
  | 'descriptive_only'
  | 'exploratory'
  | 'train_supported'
  | 'oos_supported'
  | 'robust'
  | 'insufficient_sample'
  | 'confounded';

export interface ResearchResult {
  readonly population: ResearchPopulationInfo;
  readonly sample: ResearchSampleInfo;
  readonly controls: ResearchControlsInfo;
  readonly descriptive: ResearchDescriptiveStats;
  readonly effect: ResearchEffectStats;
  readonly uncertainty: ResearchUncertaintyStats;
  readonly dependence: ResearchDependenceStats;
  readonly provenance: Provenance;
  readonly evidenceStatus?: EvidenceStatus | undefined;
}

export type MarketSession = 'asia' | 'london' | 'new_york' | 'off_hours';

export interface HtfRegimeSnapshot {
  readonly timeframe: Timeframe;
  readonly causalCandleCount: number;
  readonly lastCompletedTimestamp: number;
  readonly causalAtr: Decimal;
  readonly trend: 'bullish' | 'bearish' | 'sideways';
  readonly lastClose: Decimal;
}

export interface ContextSnapshot {
  readonly atr: Decimal;
  readonly trendRegime: 'bullish' | 'bearish' | 'range';
  readonly volatilityRegime: 'low' | 'normal' | 'high';
  readonly session?: MarketSession | undefined;
  readonly htfContext?: Readonly<Partial<Record<Timeframe, HtfRegimeSnapshot>>> | undefined;
}

export interface ResearchObservation {
  readonly event: BaseEvent;
  readonly context: ContextSnapshot;
  readonly outcome: EventOutcome;
  readonly provenance: Provenance;
}

export type ResamplingUnit = 'event' | 'pair' | 'episode' | 'day' | 'session';
export type ResamplingMethod = 'bootstrap' | 'permutation';

export interface ResamplingPlan {
  readonly unit: ResamplingUnit;
  readonly method: ResamplingMethod;
  readonly iterations: number;
  readonly seed?: number | undefined;
}

/**
 * Fully reproducible experiment definition. Every hash here must be stable across runs
 * given identical inputs — changing any config must produce a different hash.
 */
export interface ResearchExperiment {
  readonly experimentId: string;
  readonly datasetHash: string;
  readonly detectorConfigHash: string;
  readonly outcomeConfigHash: string;
  readonly controlDefinitionHash: string;
  readonly hypothesisDefinitionHash?: string | undefined;
  readonly resamplingPlan: ResamplingPlan;
  readonly softwareCommit?: string | undefined;
  readonly createdAt: number;
}
