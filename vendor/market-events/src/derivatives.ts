import { Decimal } from 'decimal.js';
import type { DerivativesEvent, DerivativesSnapshot, Timeframe } from './types.js';

export interface DerivativesOptions {
  readonly symbol: string;
  readonly timeframe: Timeframe;
  readonly oiExpansionThreshold?: Decimal;
  readonly fundingExtremeThreshold?: Decimal;
}

/**
 * Detects derivatives events: Open Interest shifts and extreme funding rates as objective observations
 * with exact quantitative measurements and without imposing directional dogma.
 */
export function detectDerivativesEvents(
  snapshots: readonly DerivativesSnapshot[],
  options: DerivativesOptions
): DerivativesEvent[] {
  if (snapshots.length < 2) return [];

  const oiThreshold = options.oiExpansionThreshold ?? new Decimal(0.05); // 5% shift
  const fundingExtreme = options.fundingExtremeThreshold ?? new Decimal(0.0003); // 0.03%
  const events: DerivativesEvent[] = [];

  for (let i = 1; i < snapshots.length; i++) {
    const current = snapshots[i]!;
    const prev = snapshots[i - 1]!;

    if (prev.openInterest.gt(0)) {
      const oiChangeRatio = current.openInterest.minus(prev.openInterest).dividedBy(prev.openInterest);

      if (oiChangeRatio.abs().gte(oiThreshold)) {
        const isExpansion = oiChangeRatio.gt(0);
        events.push({
          id: `${options.symbol}-${options.timeframe}-deriv-${isExpansion ? 'oi-exp' : 'oi-cont'}-${current.timestamp}`,
          type: 'derivatives',
          symbol: options.symbol,
          timeframe: options.timeframe,
          detectedAt: current.timestamp,
          originIndex: i,
          originTimestamp: current.timestamp,
          availableAtIndex: i,
          availableAtTimestamp: current.timestamp,
          direction: isExpansion ? 'bullish' : 'bearish',
          derivativesType: isExpansion ? 'oi_expansion' : 'oi_contraction',
          metricValue: current.openInterest,
          baselineValue: prev.openInterest,
          changePercentage: oiChangeRatio.times(100),
          isObservationOnly: true
        });
      }
    }

    if (current.fundingRate.abs().gte(fundingExtreme)) {
      const isPositive = current.fundingRate.gt(0);
      events.push({
        id: `${options.symbol}-${options.timeframe}-deriv-fund-ext-${current.timestamp}`,
        type: 'derivatives',
        symbol: options.symbol,
        timeframe: options.timeframe,
        detectedAt: current.timestamp,
        originIndex: i,
        originTimestamp: current.timestamp,
        availableAtIndex: i,
        availableAtTimestamp: current.timestamp,
        direction: isPositive ? 'bullish' : 'bearish',
        derivativesType: 'funding_extreme',
        metricValue: current.fundingRate,
        baselineValue: fundingExtreme,
        changePercentage: new Decimal(0),
        isObservationOnly: true
      });
    }
  }

  return events;
}
