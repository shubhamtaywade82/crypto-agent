import type {
  Candle,
  MarketRegime,
  Timeframe,
  TimeframeState,
  VolatilityRegime,
} from '../domain/market/types.js';
import { atr, ema, lastTwoValid, lastValid, macd, percentileOfLast, rsi } from './indicators.js';
import { analyzeStructure } from './structure-engine.js';

export const buildVolatility = (
  candles: readonly Candle[],
  atrSeries: readonly number[],
  atrPercentThresholds = { low: 0.4, high: 1.5, extreme: 3.0 }
): { view: import('../domain/market/types.js').VolatilityView; atrPercent: number } => {
  const atrNow = lastValid([...atrSeries]);
  const last = candles[candles.length - 1];
  const price = last ? last.close : Number.NaN;
  const atrPercent = price > 0 ? (atrNow / price) * 100 : Number.NaN;
  const percentile = percentileOfLast(atrSeries);
  const regime: VolatilityRegime =
    atrPercent > atrPercentThresholds.extreme ? 'HIGH_VOLATILITY'
      : percentile >= 85 ? 'EXPANSION'
        : atrPercent < atrPercentThresholds.low ? 'LOW_VOLATILITY'
          : 'NORMAL';
  return {
    view: { atr: atrNow, atrPercent, atrPercentile: percentile, regime },
    atrPercent,
  };
};

export const buildTimeframeState = (
  timeframe: Timeframe,
  candles: readonly Candle[]
): TimeframeState => {
  const closes = candles.map((c) => c.close);
  const structure = analyzeStructure(candles);
  const atrSeries = atr(candles);
  const rsiSeries = rsi(closes);
  const [rsiNow, rsiPrev] = lastTwoValid(rsiSeries);
  const m = macd(closes);
  const e50 = ema(closes, 50);
  const e200 = ema(closes, 200);
  const { view: vol } = buildVolatility(candles, atrSeries);
  const last = candles[candles.length - 1];

  return {
    timeframe,
    candles: candles.length,
    lastClose: last ? last.close : Number.NaN,
    structure: structure.view,
    momentum: {
      rsi: rsiNow,
      rsiPrev,
      macd: lastValid(m.macd),
      macdSignal: lastValid(m.signal),
      macdHist: lastValid(m.hist),
      ema50: lastValid(e50),
      ema200: lastValid(e200),
    },
    volatility: vol,
  };
};

/**
 * Deterministic regime classification combining structure, EMA placement,
 * volatility expansion and panic detection.
 */
export const classifyRegime = (
  tf: TimeframeState,
  recentCandles: readonly Candle[]
): MarketRegime => {
  const { structure, momentum, volatility } = tf;
  const last = recentCandles[recentCandles.length - 1];
  if (!last || volatility.atrPercent > 6) return 'PANIC';

  const above50 = last.close > momentum.ema50;
  const emaStackedBull = momentum.ema50 > momentum.ema200;
  const emaStackedBear = momentum.ema50 < momentum.ema200;
  const body = Math.abs(last.close - last.open);
  const range = Math.max(1e-12, last.high - last.low);

  if (volatility.regime === 'HIGH_VOLATILITY') return 'HIGH_VOLATILITY';
  if (volatility.regime === 'EXPANSION' && structure.bos && structure.trend === 'BULLISH') {
    return 'BREAKOUT';
  }
  if (volatility.regime === 'EXPANSION' && structure.bos && structure.trend === 'BEARISH') {
    return 'BREAKOUT';
  }
  if (volatility.regime === 'LOW_VOLATILITY' && volatility.atrPercentile < 20) {
    return 'COMPRESSION';
  }
  if (structure.trend === 'BULLISH' && above50 && emaStackedBull) return 'TREND_UP';
  if (structure.trend === 'BEARISH' && !above50 && emaStackedBear) return 'TREND_DOWN';
  if (body / range < 0.25 && momentum.rsi > 40 && momentum.rsi < 60) return 'RANGE';
  if (volatility.regime === 'EXPANSION') return 'EXPANSION';
  if (volatility.regime === 'LOW_VOLATILITY') return 'LOW_VOLATILITY';
  return structure.trend === 'BULLISH' ? 'TREND_UP'
    : structure.trend === 'BEARISH' ? 'TREND_DOWN' : 'RANGE';
};
