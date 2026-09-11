import type { Candle, OrderBlockEvent, StructureBreakEvent, Timeframe } from './types.js';

export interface OrderBlockOptions {
  readonly symbol: string;
  readonly timeframe: Timeframe;
  readonly lookbackBars?: number;
}

/**
 * Detects Order Blocks anchored to confirmed structure breaks.
 * Bullish OB: last down-close candle before the upward structural break.
 * Bearish OB: last up-close candle before the downward structural break.
 */
export function detectOrderBlocks(
  candles: readonly Candle[],
  breaks: readonly StructureBreakEvent[],
  options: OrderBlockOptions
): OrderBlockEvent[] {
  const lookback = options.lookbackBars ?? 10;
  const blocks: OrderBlockEvent[] = [];

  for (const brk of breaks) {
    const breakIndex = brk.availableAtIndex;
    const searchStart = Math.max(0, breakIndex - lookback);

    if (brk.direction === 'bullish') {
      // Find last down-close candle before the break move
      for (let j = breakIndex - 1; j >= searchStart; j--) {
        const c = candles[j]!;
        if (c.close.lte(c.open)) {
          blocks.push({
            id: `${options.symbol}-${options.timeframe}-ob-bull-${c.timestamp}`,
            type: 'order_block',
            symbol: options.symbol,
            timeframe: options.timeframe,
            detectedAt: brk.detectedAt,
            originIndex: j,
            originTimestamp: c.timestamp,
            availableAtIndex: brk.availableAtIndex,
            availableAtTimestamp: brk.availableAtTimestamp,
            timeline: {
              originIndex: j,
              originTimestamp: c.timestamp,
              formedAtIndex: j,
              formedAtTimestamp: c.timestamp,
              confirmedAtIndex: breakIndex,
              confirmedAtTimestamp: brk.detectedAt,
              availableAtIndex: brk.availableAtIndex,
              availableAtTimestamp: brk.availableAtTimestamp
            },
            direction: 'bullish',
            top: c.high,
            bottom: c.low,
            size: c.high.minus(c.low),
            originCandleIndex: j
          });
          break;
        }
      }
    } else {
      // Bearish break: find last up-close candle before the break move
      for (let j = breakIndex - 1; j >= searchStart; j--) {
        const c = candles[j]!;
        if (c.close.gte(c.open)) {
          blocks.push({
            id: `${options.symbol}-${options.timeframe}-ob-bear-${c.timestamp}`,
            type: 'order_block',
            symbol: options.symbol,
            timeframe: options.timeframe,
            detectedAt: brk.detectedAt,
            originIndex: j,
            originTimestamp: c.timestamp,
            availableAtIndex: brk.availableAtIndex,
            availableAtTimestamp: brk.availableAtTimestamp,
            timeline: {
              originIndex: j,
              originTimestamp: c.timestamp,
              formedAtIndex: j,
              formedAtTimestamp: c.timestamp,
              confirmedAtIndex: breakIndex,
              confirmedAtTimestamp: brk.detectedAt,
              availableAtIndex: brk.availableAtIndex,
              availableAtTimestamp: brk.availableAtTimestamp
            },
            direction: 'bearish',
            top: c.high,
            bottom: c.low,
            size: c.high.minus(c.low),
            originCandleIndex: j
          });
          break;
        }
      }
    }
  }

  return blocks;
}
