/**
 * Shared type aliases re-exported from underlying deterministic packages
 * so that consumers of the research agent do not need to depend on the
 * lower-level packages directly for common surface types.
 *
 * The agent itself never owns market-event or research logic; it only
 * invokes deterministic engines through tools.
 *
 * @packageDocumentation
 */
export type { Candle, Timeframe, BaseEvent, MarketEvent, FvgEvent, StructureBreakEvent, OrderBlockEvent, LiquiditySweepEvent, DisplacementEvent, EventDirection, } from '@nemesis-oss/market-events';
export type { ResearchObservation, ComponentStudyResult, MultipleTestingSummary, ResearchResult, EvidenceStatus, OutcomeConfig, AmbiguityPolicy, ContextSnapshot, Provenance, } from '@nemesis-oss/market-research';
export type { InteractionPairAnalysis, ConditionalInteractionResult, AnchorInteractionOptions, EventObservation, } from '@nemesis-oss/market-research';
export type { NegativeEvidenceImpactResult, NegativeEvidenceFlags, } from '@nemesis-oss/market-research';
export type { StabilitySummary, WalkForwardWindow, WalkForwardOptions, } from '@nemesis-oss/market-research';
/** Event types the agent can dispatch to deterministic detectors. */
export declare const DETECTABLE_EVENT_TYPES: readonly ["fvg", "bos", "choch", "mss", "order_block", "liquidity_sweep", "displacement"];
export type DetectableEventType = (typeof DETECTABLE_EVENT_TYPES)[number];
//# sourceMappingURL=types.d.ts.map