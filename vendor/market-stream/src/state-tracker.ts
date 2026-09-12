import type { Candle, Timeframe, BaseEvent } from '@nemesis-oss/market-events';
import {
  detectSwings,
  detectStructureBreaks,
  detectFvg,
  detectBos,
  detectChoch,
  detectMss,
  detectOrderBlocks,
  detectLiquiditySweeps,
  detectDisplacement,
} from '@nemesis-oss/market-events';
import { extractContextSnapshot } from '@nemesis-oss/market-research';

import type { MarketState, DetectableEventType } from './types.js';
import type { CandleBuffer } from './candle-buffer.js';

/**
 * Maintains a {@link MarketState} for a single symbol+timeframe by
 * processing closed candles from a {@link CandleBuffer}.
 *
 * On each new closed candle:
 *  1. Push the candle into the buffer.
 *  2. Extract the market context (trend, volatility, ATR, session) using
 *     {@link extractContextSnapshot} from market-research.
 *  3. Run the configured event detectors on the buffer.
 *  4. Filter events to only those whose `availableAtIndex` falls within
 *     the last `eventLookbackBars` candles.
 *  5. Emit the updated MarketState.
 *
 * The detector set is configurable. Running all 7 detectors on every
 * candle is the most expensive option; users who only need FVG detection
 * can pass `detectors: ['fvg']`.
 */
export class StateTracker {
  private state: MarketState | null = null;
  private readonly detectors: readonly DetectableEventType[];
  private readonly eventLookbackBars: number;

  constructor(
    private readonly symbol: string,
    private readonly timeframe: Timeframe,
    private readonly buffer: CandleBuffer,
    detectors: readonly DetectableEventType[] | null,
    eventLookbackBars: number,
  ) {
    this.detectors = detectors ?? [];
    this.eventLookbackBars = eventLookbackBars;
  }

  /**
   * Process a new closed candle and return the updated MarketState, or
   * null if the buffer is too small for context extraction.
   */
  onCandle(candle: Candle): MarketState | null {
    this.buffer.push(candle);
    const candles = this.buffer.toArray();
    if (candles.length < 2) return null;

    const latestIndex = candles.length - 1;
    const snapshot = extractContextSnapshot(candles, latestIndex);

    const activeEvents = this.detectEvents(candles);
    const latest = candles[latestIndex]!;

    this.state = {
      symbol: this.symbol,
      timeframe: this.timeframe,
      timestamp: latest.timestamp,
      price: latest.close.toString(),
      candleCount: candles.length,
      trendRegime: snapshot.trendRegime,
      volatilityRegime: snapshot.volatilityRegime,
      atr: snapshot.atr.toString(),
      session: snapshot.session ?? 'off_hours',
      activeEvents,
      updatedAt: Date.now(),
    };

    return this.state;
  }

  /** Get the current state without producing a new one. */
  get current(): MarketState | null {
    return this.state;
  }

  /**
   * Run the configured detectors on the candle buffer and return only
   * events whose `availableAtIndex` falls within the last
   * `eventLookbackBars` candles.
   */
  private detectEvents(candles: readonly Candle[]): readonly BaseEvent[] {
    if (this.detectors.length === 0) return [];

    const symbol = this.symbol;
    const timeframe = this.timeframe;
    const latestIndex = candles.length - 1;
    const minAvailableIndex = Math.max(0, latestIndex - this.eventLookbackBars + 1);

    const swings = detectSwings(candles, { leftBars: 2, rightBars: 2 });
    const structure = detectStructureBreaks(candles, swings, { symbol, timeframe });

    const allEvents: BaseEvent[] = [];

    for (const det of this.detectors) {
      let events: readonly BaseEvent[];
      switch (det) {
        case 'fvg':
          events = detectFvg(candles, { symbol, timeframe });
          break;
        case 'bos':
          events = detectBos(candles, swings, { symbol, timeframe });
          break;
        case 'choch':
          events = detectChoch(candles, swings, { symbol, timeframe });
          break;
        case 'mss':
          events = detectMss(candles, swings, { symbol, timeframe });
          break;
        case 'order_block':
          events = detectOrderBlocks(candles, structure, { symbol, timeframe });
          break;
        case 'liquidity_sweep':
          events = detectLiquiditySweeps(candles, swings, { symbol, timeframe });
          break;
        case 'displacement':
          events = detectDisplacement(candles, { symbol, timeframe });
          break;
        default: {
          const _exhaustive: never = det;
          throw new Error(`Unknown detector: ${String(_exhaustive)}`);
        }
      }
      allEvents.push(...events);
    }

    // Filter to events available within the lookback window, sort newest first.
    return allEvents
      .filter((e) => e.availableAtIndex >= minAvailableIndex)
      .sort((a, b) => b.availableAtIndex - a.availableAtIndex);
  }
}
