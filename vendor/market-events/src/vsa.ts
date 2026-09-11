import { Decimal } from 'decimal.js';
import type { Candle, Timeframe, VsaEvent } from './types.js';

export interface VsaOptions {
  readonly symbol: string;
  readonly timeframe: Timeframe;
  readonly lookback?: number;
  readonly highVolumeThreshold?: Decimal;
  readonly lowVolumeThreshold?: Decimal;
}

/**
 * Detects Volume Spread Analysis (VSA) events deterministically from candle spread and relative volume.
 */
export function detectVsaEvents(
  candles: readonly Candle[],
  options: VsaOptions
): VsaEvent[] {
  const lookback = options.lookback ?? 20;
  if (candles.length <= lookback) return [];

  const highVolThresh = options.highVolumeThreshold ?? new Decimal(1.8);
  const lowVolThresh = options.lowVolumeThreshold ?? new Decimal(0.7);
  const events: VsaEvent[] = [];

  for (let i = lookback; i < candles.length; i++) {
    const c = candles[i]!;
    const spread = c.high.minus(c.low);

    let sumVol = new Decimal(0);
    let sumSpread = new Decimal(0);
    for (let j = i - lookback; j < i; j++) {
      sumVol = sumVol.plus(candles[j]!.volume);
      sumSpread = sumSpread.plus(candles[j]!.high.minus(candles[j]!.low));
    }
    const avgVol = sumVol.dividedBy(lookback);
    const avgSpread = sumSpread.dividedBy(lookback);

    if (avgVol.isZero() || avgSpread.isZero()) continue;

    const volumeRatio = c.volume.dividedBy(avgVol);
    const spreadRatio = spread.dividedBy(avgSpread);
    const isUpCandle = c.close.gt(c.open);

    if (isUpCandle && volumeRatio.lt(lowVolThresh) && spreadRatio.lt(1.0)) {
      // No Demand: Up-bar with below average volume and narrow spread
      events.push({
        id: `${options.symbol}-${options.timeframe}-vsa-nodemand-${c.timestamp}`,
        type: 'vsa',
        symbol: options.symbol,
        timeframe: options.timeframe,
        detectedAt: c.timestamp,
        originIndex: i,
        originTimestamp: c.timestamp,
        availableAtIndex: i,
        availableAtTimestamp: c.timestamp,
        direction: 'bearish',
        vsaType: 'no_demand',
        volumeRatio,
        spreadRatio
      });
    } else if (!isUpCandle && volumeRatio.lt(lowVolThresh) && spreadRatio.lt(1.0)) {
      // No Supply: Down-bar with below average volume and narrow spread
      events.push({
        id: `${options.symbol}-${options.timeframe}-vsa-nosupply-${c.timestamp}`,
        type: 'vsa',
        symbol: options.symbol,
        timeframe: options.timeframe,
        detectedAt: c.timestamp,
        originIndex: i,
        originTimestamp: c.timestamp,
        availableAtIndex: i,
        availableAtTimestamp: c.timestamp,
        direction: 'bullish',
        vsaType: 'no_supply',
        volumeRatio,
        spreadRatio
      });
    } else if (!isUpCandle && volumeRatio.gte(highVolThresh) && c.close.minus(c.low).gt(spread.times(0.4))) {
      // Stopping Volume: Ultra-high volume down-bar with close well off the lows (buying absorption)
      events.push({
        id: `${options.symbol}-${options.timeframe}-vsa-stopping-${c.timestamp}`,
        type: 'vsa',
        symbol: options.symbol,
        timeframe: options.timeframe,
        detectedAt: c.timestamp,
        originIndex: i,
        originTimestamp: c.timestamp,
        availableAtIndex: i,
        availableAtTimestamp: c.timestamp,
        direction: 'bullish',
        vsaType: 'stopping_volume',
        volumeRatio,
        spreadRatio
      });
    }
  }

  return events;
}
