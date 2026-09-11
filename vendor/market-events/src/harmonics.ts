import { Decimal } from 'decimal.js';
import type { HarmonicPatternEvent, HarmonicPatternType, SwingPoint, Timeframe } from './types.js';

export interface HarmonicRatioConfig {
  readonly name: HarmonicPatternType;
  readonly bRetraceMin: Decimal;
  readonly bRetraceMax: Decimal;
  readonly dRetraceMin: Decimal;
  readonly dRetraceMax: Decimal;
}

const HARMONIC_CONFIGS: readonly HarmonicRatioConfig[] = [
  {
    name: 'gartley',
    bRetraceMin: new Decimal(0.55),
    bRetraceMax: new Decimal(0.68),
    dRetraceMin: new Decimal(0.75),
    dRetraceMax: new Decimal(0.82)
  },
  {
    name: 'bat',
    bRetraceMin: new Decimal(0.35),
    bRetraceMax: new Decimal(0.52),
    dRetraceMin: new Decimal(0.85),
    dRetraceMax: new Decimal(0.92)
  }
];

export interface HarmonicOptions {
  readonly symbol: string;
  readonly timeframe: Timeframe;
}

/**
 * Detects 5-point XABCD harmonic patterns (Gartley, Bat) from swing pivot sequences.
 */
export function detectHarmonicPatterns(
  swings: readonly SwingPoint[],
  options: HarmonicOptions
): HarmonicPatternEvent[] {
  if (swings.length < 5) return [];
  const events: HarmonicPatternEvent[] = [];

  for (let i = 4; i < swings.length; i++) {
    const x = swings[i - 4]!;
    const a = swings[i - 3]!;
    const b = swings[i - 2]!;
    const c = swings[i - 1]!;
    const d = swings[i]!;

    const isBullStructure = x.type === 'low' && a.type === 'high' && b.type === 'low' && c.type === 'high' && d.type === 'low';
    const isBearStructure = x.type === 'high' && a.type === 'low' && b.type === 'high' && c.type === 'low' && d.type === 'high';

    if (!isBullStructure && !isBearStructure) continue;

    const xaMove = a.price.minus(x.price).abs();
    if (xaMove.isZero()) continue;

    const bRetrace = b.price.minus(a.price).abs().dividedBy(xaMove);
    // In classical harmonics: D retracement of XA move is measured from A
    const dRetrace = a.price.minus(d.price).abs().dividedBy(xaMove);

    for (const config of HARMONIC_CONFIGS) {
      if (
        bRetrace.gte(config.bRetraceMin) &&
        bRetrace.lte(config.bRetraceMax) &&
        dRetrace.gte(config.dRetraceMin) &&
        dRetrace.lte(config.dRetraceMax)
      ) {
        const direction = isBullStructure ? 'bullish' : 'bearish';
        const przBuffer = xaMove.times(0.02);
        const prz = {
          top: d.price.plus(przBuffer),
          bottom: d.price.minus(przBuffer)
        };

        events.push({
          id: `${options.symbol}-${options.timeframe}-harmonic-${config.name}-${d.timestamp}`,
          type: 'harmonic_pattern',
          symbol: options.symbol,
          timeframe: options.timeframe,
          detectedAt: d.timestamp,
          originIndex: x.index,
          originTimestamp: x.timestamp,
          availableAtIndex: d.confirmedAtIndex,
          availableAtTimestamp: d.confirmedAtTimestamp ?? d.timestamp,
          timeline: {
            originIndex: x.index,
            originTimestamp: x.timestamp,
            formedAtIndex: d.index,
            formedAtTimestamp: d.timestamp,
            confirmedAtIndex: d.confirmedAtIndex,
            confirmedAtTimestamp: d.confirmedAtTimestamp ?? d.timestamp,
            availableAtIndex: d.confirmedAtIndex,
            availableAtTimestamp: d.confirmedAtTimestamp ?? d.timestamp
          },
          direction,
          harmonicType: config.name,
          xPrice: x.price,
          aPrice: a.price,
          bPrice: b.price,
          cPrice: c.price,
          dPrice: d.price,
          prz
        });
        break;
      }
    }
  }

  return events;
}
