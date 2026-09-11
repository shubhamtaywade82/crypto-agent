import { Decimal } from 'decimal.js';

export type Timeframe = '1m' | '3m' | '5m' | '15m' | '30m' | '1h' | '2h' | '4h' | '6h' | '8h' | '12h' | '1d' | '1w' | '1M';

export interface Candle {
  readonly timestamp: number;
  readonly open: Decimal;
  readonly high: Decimal;
  readonly low: Decimal;
  readonly close: Decimal;
  readonly volume: Decimal;
}

export type EventDirection = 'bullish' | 'bearish';

export type MarketEventType =
  | 'fvg' | 'ifvg' | 'order_block' | 'breaker_block'
  | 'bos' | 'choch' | 'mss' | 'liquidity_sweep' | 'displacement'
  | 'vsa' | 'derivatives' | 'wyckoff' | 'chart_pattern' | 'harmonic_pattern' | 'control';

export interface EventTimeline {
  readonly originIndex: number;
  readonly originTimestamp: number;
  readonly formedAtIndex?: number | undefined;
  readonly formedAtTimestamp?: number | undefined;
  readonly confirmedAtIndex?: number | undefined;
  readonly confirmedAtTimestamp?: number | undefined;
  readonly availableAtIndex: number;
  readonly availableAtTimestamp: number;
}

export interface BaseEvent {
  readonly id: string;
  readonly type: MarketEventType;
  readonly version?: string | undefined;
  readonly symbol: string;
  readonly timeframe: Timeframe;
  readonly detectedAt: number;
  readonly originIndex: number;
  readonly originTimestamp: number;
  readonly availableAtIndex: number;
  readonly availableAtTimestamp: number;
  readonly timeline?: EventTimeline | undefined;
  readonly direction: EventDirection;
}

export function validateEventCausality(event: BaseEvent): void {
  if (event.availableAtIndex < event.originIndex) {
    throw new Error(`Causal violation: availableAtIndex (${event.availableAtIndex}) < originIndex (${event.originIndex}) in ${event.id}`);
  }
  if (event.availableAtTimestamp < event.originTimestamp) {
    throw new Error(`Causal violation: availableAtTimestamp (${event.availableAtTimestamp}) < originTimestamp (${event.originTimestamp}) in ${event.id}`);
  }
  if (event.timeline) {
    const t = event.timeline;
    if (t.formedAtIndex !== undefined && t.formedAtIndex < t.originIndex) {
      throw new Error(`Causal violation: formedAtIndex (${t.formedAtIndex}) < originIndex (${t.originIndex}) in ${event.id}`);
    }
    if (t.formedAtIndex !== undefined && t.confirmedAtIndex !== undefined && t.confirmedAtIndex < t.formedAtIndex) {
      throw new Error(`Causal violation: confirmedAtIndex (${t.confirmedAtIndex}) < formedAtIndex (${t.formedAtIndex}) in ${event.id}`);
    }
    if (t.confirmedAtIndex !== undefined && t.availableAtIndex < t.confirmedAtIndex) {
      throw new Error(`Causal violation: availableAtIndex (${t.availableAtIndex}) < confirmedAtIndex (${t.confirmedAtIndex}) in ${event.id}`);
    }
    if (t.formedAtTimestamp !== undefined && t.formedAtTimestamp < t.originTimestamp) {
      throw new Error(`Causal violation: formedAtTimestamp (${t.formedAtTimestamp}) < originTimestamp (${t.originTimestamp}) in ${event.id}`);
    }
    if (t.formedAtTimestamp !== undefined && t.confirmedAtTimestamp !== undefined && t.confirmedAtTimestamp < t.formedAtTimestamp) {
      throw new Error(`Causal violation: confirmedAtTimestamp (${t.confirmedAtTimestamp}) < formedAtTimestamp (${t.formedAtTimestamp}) in ${event.id}`);
    }
    if (t.confirmedAtTimestamp !== undefined && t.availableAtTimestamp < t.confirmedAtTimestamp) {
      throw new Error(`Causal violation: availableAtTimestamp (${t.availableAtTimestamp}) < confirmedAtTimestamp (${t.confirmedAtTimestamp}) in ${event.id}`);
    }
  }
}

export interface FvgEvent extends BaseEvent {
  readonly type: 'fvg';
  readonly top: Decimal;
  readonly bottom: Decimal;
  readonly consequentEncroachment: Decimal;
  readonly size: Decimal;
}

export type SwingType = 'high' | 'low';
export type SwingScale = 'micro' | 'minor' | 'intermediate' | 'major';
export type StructureScope = 'internal' | 'external';
export type SwingStrength = SwingScale | StructureScope;

export interface SwingPoint {
  readonly id: string;
  readonly type: SwingType;
  readonly index: number;
  readonly timestamp: number;
  readonly price: Decimal;
  readonly confirmedAtIndex: number;
  readonly confirmedAtTimestamp?: number | undefined;
  readonly strength?: SwingStrength | undefined;
  readonly scale?: SwingScale | undefined;
  readonly scope?: StructureScope | undefined;
}

export type TrendState = 'bullish' | 'bearish' | 'sideways';
export type TransitionState = 'continuation' | 'choch' | 'mss' | 'reversal';
export type StructureLevel = 'internal' | 'external';

export interface StructureState {
  readonly trend: TrendState;
  readonly transition: TransitionState;
  readonly protectedHigh?: SwingPoint | undefined;
  readonly protectedLow?: SwingPoint | undefined;
  readonly lastConfirmedHigh?: SwingPoint | undefined;
  readonly lastConfirmedLow?: SwingPoint | undefined;
}

export interface StructureBreakEvent extends BaseEvent {
  readonly type: 'bos' | 'choch' | 'mss';
  readonly brokenSwing: SwingPoint;
  readonly breakPrice: Decimal;
  readonly isCloseConfirmed: boolean;
  readonly level?: StructureLevel | undefined;
  readonly trendBeforeBreak?: TrendState | undefined;
  readonly trendAfterBreak?: TrendState | undefined;
}

export interface OrderBlockEvent extends BaseEvent {
  readonly type: 'order_block';
  readonly top: Decimal;
  readonly bottom: Decimal;
  readonly size: Decimal;
  readonly originCandleIndex: number;
}

export type LiquidityTargetType = 'bsl' | 'ssl';
export type LiquidityPoolType =
  | 'single_high'
  | 'single_low'
  | 'equal_highs'
  | 'equal_lows'
  | 'session_high'
  | 'session_low'
  | 'pdh'
  | 'pdl'
  | 'cluster';

export type LiquidityPoolStatus = 'active' | 'swept' | 'mitigated' | 'invalidated';

export interface LiquidityPool {
  readonly poolId: string;
  readonly price: Decimal;
  readonly targetType: LiquidityTargetType;
  readonly poolType: LiquidityPoolType;
  readonly strength: SwingStrength | 'composite';
  readonly firstObservedAt: number;
  readonly confirmedAtIndex: number;
  readonly formationTime: number;
  readonly touchCount: number;
  readonly source: string;
  readonly status: LiquidityPoolStatus;
  readonly sweptAtTimestamp?: number | undefined;
  readonly sweptByIndex?: number | undefined;
}

export interface LiquiditySweepEvent extends BaseEvent {
  readonly type: 'liquidity_sweep';
  readonly sweptLevel: Decimal;
  readonly sweepExtreme: Decimal;
  readonly targetType: 'bsl' | 'ssl';
  readonly reclaimed: boolean;
  readonly poolId?: string | undefined;
  readonly poolType?: LiquidityPoolType | undefined;
  readonly penetrationTicks?: Decimal | undefined;
}

export interface BreakerBlockEvent extends BaseEvent {
  readonly type: 'breaker_block';
  readonly top: Decimal;
  readonly bottom: Decimal;
  readonly size: Decimal;
  readonly originalOrderBlockId: string;
}

export interface InvertedFvgEvent extends BaseEvent {
  readonly type: 'ifvg';
  readonly top: Decimal;
  readonly bottom: Decimal;
  readonly size: Decimal;
  readonly originalFvgId: string;
}

export interface DisplacementEvent extends BaseEvent {
  readonly type: 'displacement';
  readonly magnitudeAtr: Decimal;
  readonly bodyRatio: Decimal;
  readonly candleIndex: number;
}

export type VsaEventType =
  | 'stopping_volume'
  | 'no_demand'
  | 'no_supply'
  | 'effort_vs_result'
  | 'climax';

export interface VsaEvent extends BaseEvent {
  readonly type: 'vsa';
  readonly vsaType: VsaEventType;
  readonly volumeRatio: Decimal;
  readonly spreadRatio: Decimal;
}

export interface DerivativesSnapshot {
  readonly timestamp: number;
  readonly openInterest: Decimal;
  readonly fundingRate: Decimal;
  readonly takerBuyVolume: Decimal;
  readonly takerSellVolume: Decimal;
}

export type DerivativesEventType =
  | 'oi_expansion'
  | 'oi_contraction'
  | 'funding_extreme'
  | 'aggressive_taker_flow';

export interface DerivativesEvent extends BaseEvent {
  readonly type: 'derivatives';
  readonly derivativesType: DerivativesEventType;
  readonly metricValue: Decimal;
  readonly baselineValue: Decimal;
  readonly changePercentage?: Decimal | undefined;
  readonly isObservationOnly?: boolean | undefined;
}

export type WyckoffEventType =
  | 'spring'
  | 'upthrust'
  | 'selling_climax'
  | 'buying_climax'
  | 'sign_of_strength'
  | 'sign_of_weakness';

export interface WyckoffEvent extends BaseEvent {
  readonly type: 'wyckoff';
  readonly wyckoffType: WyckoffEventType;
  readonly referenceLevel: Decimal;
  readonly extremePrice: Decimal;
}

export type ChartPatternType =
  | 'double_top'
  | 'double_bottom'
  | 'ascending_triangle'
  | 'descending_triangle';

export interface ChartPatternEvent extends BaseEvent {
  readonly type: 'chart_pattern';
  readonly patternType: ChartPatternType;
  readonly firstLevel: Decimal;
  readonly secondLevel: Decimal;
  readonly neckline: Decimal;
}

export type HarmonicPatternType = 'gartley' | 'bat' | 'butterfly' | 'crab';

export interface HarmonicPatternEvent extends BaseEvent {
  readonly type: 'harmonic_pattern';
  readonly harmonicType: HarmonicPatternType;
  readonly xPrice: Decimal;
  readonly aPrice: Decimal;
  readonly bPrice: Decimal;
  readonly cPrice: Decimal;
  readonly dPrice: Decimal;
  readonly prz: { readonly top: Decimal; readonly bottom: Decimal };
}

export type MarketEvent =
  | FvgEvent
  | InvertedFvgEvent
  | OrderBlockEvent
  | BreakerBlockEvent
  | StructureBreakEvent
  | LiquiditySweepEvent
  | DisplacementEvent
  | VsaEvent
  | DerivativesEvent
  | WyckoffEvent
  | ChartPatternEvent
  | HarmonicPatternEvent;

