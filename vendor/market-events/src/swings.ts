import type { Candle, SwingPoint, SwingStrength } from './types.js';

export interface SwingDetectionOptions {
  readonly leftBars?: number;
  readonly rightBars?: number;
  readonly strength?: SwingStrength;
}

export const SWING_PRESETS: Record<SwingStrength, { leftBars: number; rightBars: number }> = {
  micro: { leftBars: 1, rightBars: 1 },
  minor: { leftBars: 2, rightBars: 2 },
  internal: { leftBars: 3, rightBars: 3 },
  intermediate: { leftBars: 5, rightBars: 5 },
  major: { leftBars: 10, rightBars: 10 },
  external: { leftBars: 10, rightBars: 10 }
};

function checkIsSwingHigh(candles: readonly Candle[], index: number, left: number, right: number): boolean {
  const target = candles[index]!;
  for (let offset = -left; offset <= right; offset++) {
    if (offset === 0) continue;
    if (candles[index + offset]!.high.gte(target.high)) return false;
  }
  return true;
}

function checkIsSwingLow(candles: readonly Candle[], index: number, left: number, right: number): boolean {
  const target = candles[index]!;
  for (let offset = -left; offset <= right; offset++) {
    if (offset === 0) continue;
    if (candles[index + offset]!.low.lte(target.low)) return false;
  }
  return true;
}

/**
 * Detects swing highs and swing lows using symmetrical left/right bar confirmation.
 */
export function detectSwings(
  candles: readonly Candle[],
  options: SwingDetectionOptions = {}
): SwingPoint[] {
  const left = options.leftBars ?? 2;
  const right = options.rightBars ?? 2;
  const scale = (left >= 10 ? 'major' : left >= 5 ? 'intermediate' : 'minor') as 'major' | 'intermediate' | 'minor';
  const strength = options.strength ?? scale;
  const swings: SwingPoint[] = [];

  for (let i = left; i < candles.length - right; i++) {
    const candidate = candles[i]!;
    const confirmedAtIndex = i + right;
    const confirmedAtTimestamp = candles[confirmedAtIndex]?.timestamp ?? candidate.timestamp;

    if (checkIsSwingHigh(candles, i, left, right)) {
      swings.push({
        id: `swing-high-${strength}-${candidate.timestamp}`,
        type: 'high',
        index: i,
        timestamp: candidate.timestamp,
        price: candidate.high,
        confirmedAtIndex,
        confirmedAtTimestamp,
        strength,
        scale
      });
    }

    if (checkIsSwingLow(candles, i, left, right)) {
      swings.push({
        id: `swing-low-${strength}-${candidate.timestamp}`,
        type: 'low',
        index: i,
        timestamp: candidate.timestamp,
        price: candidate.low,
        confirmedAtIndex,
        confirmedAtTimestamp,
        strength,
        scale
      });
    }
  }

  return swings.sort((a, b) => a.index - b.index);
}

/**
 * Detects multi-scale market swings across micro, minor, intermediate, and major resolutions.
 */
export function detectMultiScaleSwings(
  candles: readonly Candle[]
): Record<'micro' | 'minor' | 'intermediate' | 'major', SwingPoint[]> {
  return {
    micro: detectSwings(candles, { ...SWING_PRESETS.micro, strength: 'micro' }),
    minor: detectSwings(candles, { ...SWING_PRESETS.minor, strength: 'minor' }),
    intermediate: detectSwings(candles, { ...SWING_PRESETS.intermediate, strength: 'intermediate' }),
    major: detectSwings(candles, { ...SWING_PRESETS.major, strength: 'major' })
  };
}
