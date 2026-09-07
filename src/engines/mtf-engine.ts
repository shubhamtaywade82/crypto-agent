import type {
  Candle,
  MarketRegime,
  MarketState,
  Timeframe,
  TimeframeState,
  Trend,
} from '../domain/market/types.js';
import { TIMEFRAMES } from '../domain/market/types.js';
import { buildTimeframeState, classifyRegime } from './timeframe-engine.js';
import { analyzeStructure, detectSweep, liquidityLevels } from './structure-engine.js';
import type { SwingPoint } from './structure-engine.js';

export interface MtfInputs {
  readonly symbol: string;
  readonly candles: Readonly<Record<Timeframe, readonly Candle[]>>;
  readonly btcCandles: Readonly<Record<Timeframe, readonly Candle[]>>;
  readonly price: { last: number; mark: number; index: number };
  readonly futures: { fundingRate: number; openInterest: number; openInterestChange: number };
}

export interface MtfResult {
  readonly state: MarketState;
  readonly macro: Trend;
  readonly higherTimeframeAlignment: number;
  readonly states: Readonly<Record<Timeframe, TimeframeState>>;
  readonly swings: Readonly<Record<Timeframe, readonly SwingPoint[]>>;
}

const BASE = 1.0;

/** 4h -> 1h -> 15m -> 5m weighted alignment score. */
export const alignmentScore = (states: Readonly<Record<Timeframe, TimeframeState>>): number => {
  const weights: Record<Timeframe, number> = { '4h': 0.4, '1h': 0.3, '15m': 0.2, '5m': 0.1 };
  let score = 0;
  for (const tf of TIMEFRAMES) {
    const t = states[tf].structure.trend;
    score += weights[tf] * (t === 'BULLISH' ? BASE : t === 'BEARISH' ? -BASE : 0);
  }
  return score;
};

const mapTrendToRegime = (trend: Trend): MarketRegime =>
  trend === 'BULLISH' ? 'TREND_UP' : trend === 'BEARISH' ? 'TREND_DOWN' : 'RANGE';

const assembleState = (
  inputs: MtfInputs,
  computed: {
    readonly states: Readonly<Record<Timeframe, TimeframeState>>;
    readonly swings: Readonly<Record<Timeframe, readonly SwingPoint[]>>;
    readonly regime: MarketRegime;
    readonly btcRegime: MarketRegime;
  }
): MarketState => {
  const { states, swings, regime, btcRegime } = computed;
  const price = inputs.price.last;
  const levels = liquidityLevels(swings['1h'], price);
  const sweep = detectSweep(inputs.candles['5m'], swings['5m']);
  return {
    symbol: inputs.symbol,
    capturedAt: Date.now(),
    price: inputs.price,
    regime,
    btcRegime,
    timeframes: states,
    liquidity: {
      nearestHigh: levels.nearestHigh,
      nearestLow: levels.nearestLow,
      sweepDetected: sweep.detected,
      sweepSide: sweep.side,
    },
    futures: {
      fundingRate: inputs.futures.fundingRate,
      openInterest: inputs.futures.openInterest,
      openInterestChange: inputs.futures.openInterestChange,
      markPrice: inputs.price.mark,
      indexPrice: inputs.price.index,
    },
  };
};

export const buildMtfState = (inputs: MtfInputs): MtfResult => {
  const states = {} as Record<Timeframe, TimeframeState>;
  const swings = {} as Record<Timeframe, readonly SwingPoint[]>;
  for (const tf of TIMEFRAMES) {
    states[tf] = buildTimeframeState(tf, inputs.candles[tf]);
    swings[tf] = analyzeStructure(inputs.candles[tf]).swings;
  }
  const refTf = states['1h'];
  const refCandles = inputs.candles['1h'];
  const regime = refCandles.length > 0 ? classifyRegime(refTf, refCandles) : 'RANGE';

  const btc1h = inputs.btcCandles['1h'];
  const btcState = btc1h.length > 0 ? buildTimeframeState('1h', btc1h) : undefined;
  const btcRegime = btcState ? mapTrendToRegime(btcState.structure.trend) : 'RANGE';

  const state = assembleState(inputs, { states, swings, regime, btcRegime });
  const alignment = alignmentScore(states);
  const macro: Trend = alignment > 0.3 ? 'BULLISH' : alignment < -0.3 ? 'BEARISH' : 'RANGE';
  return { state, macro, higherTimeframeAlignment: alignment, states, swings };
};
