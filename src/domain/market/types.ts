/** A single OHLCV candle (values as strings/numbers from exchanges). */
export interface Candle {
  readonly openTime: number;
  readonly open: number;
  readonly high: number;
  readonly low: number;
  readonly close: number;
  readonly volume: number;
}

/** Supported multi-timeframe ladder. */
export const TIMEFRAMES = ['5m', '15m', '1h', '4h'] as const;
export type Timeframe = (typeof TIMEFRAMES)[number];

export type Trend = 'BULLISH' | 'BEARISH' | 'RANGE';

/** Market-structure snapshot for one timeframe (SMC-style). */
export interface StructureView {
  readonly trend: Trend;
  readonly bos: boolean;
  readonly choch: boolean;
  readonly swingHigh: number;
  readonly swingLow: number;
  readonly lastSwing: 'HIGH' | 'LOW' | 'NONE';
}

export interface MomentumView {
  readonly rsi: number;
  readonly rsiPrev: number;
  readonly macd: number;
  readonly macdSignal: number;
  readonly macdHist: number;
  readonly ema50: number;
  readonly ema200: number;
}

export type VolatilityRegime =
  | 'LOW_VOLATILITY'
  | 'NORMAL'
  | 'EXPANSION'
  | 'HIGH_VOLATILITY';

export interface VolatilityView {
  readonly atr: number;
  readonly atrPercent: number;
  readonly atrPercentile: number;
  readonly regime: VolatilityRegime;
}

export type MarketRegime =
  | 'TREND_UP'
  | 'TREND_DOWN'
  | 'RANGE'
  | 'BREAKOUT'
  | 'COMPRESSION'
  | 'EXPANSION'
  | 'HIGH_VOLATILITY'
  | 'LOW_VOLATILITY'
  | 'PANIC';

export interface LiquidityView {
  readonly nearestHigh: number;
  readonly nearestLow: number;
  readonly sweepDetected: boolean;
  readonly sweepSide: 'BUY_SIDE' | 'SELL_SIDE' | 'NONE';
}

export interface FuturesContext {
  readonly fundingRate: number;
  readonly openInterest: number;
  readonly openInterestChange: number;
  readonly markPrice: number;
  readonly indexPrice: number;
}

/** Per-timeframe intelligence slice embedded in MarketState. */
export interface TimeframeState {
  readonly timeframe: Timeframe;
  readonly candles: number;
  readonly lastClose: number;
  readonly structure: StructureView;
  readonly momentum: MomentumView;
  readonly volatility: VolatilityView;
}

/** Canonical, deterministic market intelligence snapshot (the LLM reads this). */
export interface MarketState {
  readonly symbol: string;
  readonly capturedAt: number;
  readonly price: {
    readonly last: number;
    readonly mark: number;
    readonly index: number;
  };
  readonly regime: MarketRegime;
  readonly btcRegime: MarketRegime;
  readonly timeframes: Readonly<Record<Timeframe, TimeframeState>>;
  readonly liquidity: LiquidityView;
  readonly futures: FuturesContext;
}
