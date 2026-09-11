import { Decimal } from 'decimal.js';
import type { Candle, StructureBreakEvent, SwingPoint } from '@nemesis-oss/market-events';
import { getActiveSessions } from '@nemesis-oss/market-events';
import type { ContextSnapshot, MarketSession } from './types.js';
import { type HtfCandlesMap, extractMultiTimeframeSnapshot } from './multi-timeframe.js';

export type TrendRegime = 'bullish' | 'bearish' | 'range';
export type VolatilityRegime = 'low' | 'normal' | 'high';

export interface MarketContextFeatures {
  readonly trendRegime: TrendRegime;
  readonly volatilityRegime: VolatilityRegime;
  readonly atr: Decimal;
  readonly displacementAtr: Decimal;
  readonly session?: MarketSession | undefined;
}

export function estimateIndependentTrendRegime(candles: readonly Candle[], index: number, period: number = 20): TrendRegime {
  if (index < 1) return 'range';
  const start = Math.max(0, index - period);
  const startCandle = candles[start]!;
  const currentCandle = candles[index]!;
  const netMove = currentCandle.close.minus(startCandle.close);

  let totalPath = new Decimal(0);
  for (let i = start + 1; i <= index; i++) {
    totalPath = totalPath.plus(candles[i]!.close.minus(candles[i - 1]!.close).abs());
  }

  // Directional efficiency = net displacement / total path length
  const efficiency = totalPath.gt(0) ? netMove.abs().dividedBy(totalPath) : new Decimal(0);
  if (efficiency.lt(0.30)) return 'range';
  return netMove.gt(0) ? 'bullish' : 'bearish';
}

/**
 * Extracts context features (trend, volatility, displacement, session) at a specific candle index.
 */
export function extractContextFeatures(
  candles: readonly Candle[],
  currentIndex: number,
  swings?: readonly SwingPoint[],
  breaks?: readonly StructureBreakEvent[]
): MarketContextFeatures {
  const c = candles[currentIndex]!;
  const currentRange = c.high.minus(c.low);
  const lookback = Math.min(currentIndex, 14);
  let totalRange = new Decimal(0);

  for (let i = currentIndex - lookback; i < currentIndex; i++) {
    if (i >= 0) totalRange = totalRange.plus(candles[i]!.high.minus(candles[i]!.low));
  }

  const atr = lookback > 0 ? totalRange.dividedBy(lookback) : currentRange;
  const displacementAtr = atr.gt(0) ? currentRange.dividedBy(atr) : new Decimal(1);

  let volatilityRegime: VolatilityRegime = 'normal';
  if (displacementAtr.lt(0.7)) volatilityRegime = 'low';
  else if (displacementAtr.gt(1.8)) volatilityRegime = 'high';

  // Use structure break if available, otherwise independent directional efficiency
  const priorBreaks = breaks ? breaks.filter(b => b.originIndex <= currentIndex) : [];
  const lastBreak = priorBreaks[priorBreaks.length - 1];
  const trendRegime = lastBreak ? lastBreak.direction : estimateIndependentTrendRegime(candles, currentIndex);
  const activeSess = getActiveSessions(c.timestamp);
  const session: MarketSession = activeSess[0] ?? 'off_hours';

  return { trendRegime, volatilityRegime, atr, displacementAtr, session };
}

export function extractContextSnapshot(
  candles: readonly Candle[],
  currentIndex: number,
  htfCandlesMap?: HtfCandlesMap
): ContextSnapshot {
  const feat = extractContextFeatures(candles, currentIndex);
  const currentCandle = candles[currentIndex];
  const htfContext = (htfCandlesMap && currentCandle)
    ? extractMultiTimeframeSnapshot(htfCandlesMap, currentCandle.timestamp)
    : undefined;

  return {
    atr: feat.atr,
    trendRegime: feat.trendRegime,
    volatilityRegime: feat.volatilityRegime,
    session: feat.session,
    ...(htfContext && Object.keys(htfContext).length > 0 ? { htfContext } : {})
  };
}
