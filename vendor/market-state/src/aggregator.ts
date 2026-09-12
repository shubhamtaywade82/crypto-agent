import type { MarketState as StreamMarketState } from '@nemesis-oss/market-stream';
import type { BaseEvent } from '@nemesis-oss/market-events';

/**
 * Aggregated market state across multiple symbols and timeframes.
 *
 * While {@link StreamMarketState} covers a single symbol+timeframe, this
 * interface provides a cross-symbol composite view: correlation matrix,
 * breadth indicators, and a unified event feed sorted across all streams.
 *
 * This is what `crypto-agent` reads to answer questions like "What is the
 * overall market doing?" rather than "What is BTCUSDT doing?"
 */
export interface AggregatedMarketState {
  /** Wall-clock time this snapshot was produced. */
  readonly updatedAt: number;
  /** Per-stream states, keyed by `${symbol}:${timeframe}`. */
  readonly streams: ReadonlyMap<string, StreamMarketState>;
  /** All active events across all streams, sorted newest-first. */
  readonly allEvents: readonly CrossStreamEvent[];
  /** Market breadth: % of symbols in bullish vs bearish vs range trend. */
  readonly breadth: MarketBreadth;
  /** Symbols with the most active events (top N by event count). */
  readonly hotSymbols: readonly SymbolActivity[];
}

export interface CrossStreamEvent {
  readonly event: BaseEvent;
  readonly symbol: string;
  readonly timeframe: string;
}

export interface MarketBreadth {
  readonly bullishCount: number;
  readonly bearishCount: number;
  readonly rangeCount: number;
  readonly totalSymbols: number;
  /** 0..1 fraction of symbols in bullish trend. */
  readonly bullishRatio: number;
  /** 0..1 fraction of symbols in bearish trend. */
  readonly bearishRatio: number;
}

export interface SymbolActivity {
  readonly symbol: string;
  readonly timeframe: string;
  readonly eventCount: number;
  readonly latestEventType: string;
}

/**
 * Options for {@link createMarketStateAggregator}.
 */
export interface MarketStateAggregatorOptions {
  /** Top N symbols to include in hotSymbols. Default 5. */
  readonly topN?: number;
}

/**
 * Build an {@link AggregatedMarketState} from a map of per-stream states.
 *
 * Pure function: no side effects, no async. Safe to call on every stream
 * update. The output is immutable.
 */
export function aggregateMarketState(
  streamStates: ReadonlyMap<string, StreamMarketState>,
  options: MarketStateAggregatorOptions = {},
): AggregatedMarketState {
  const topN = options.topN ?? 5;

  let bullishCount = 0;
  let bearishCount = 0;
  let rangeCount = 0;
  const allEvents: CrossStreamEvent[] = [];
  const activity: SymbolActivity[] = [];

  for (const [key, state] of streamStates) {
    if (state.trendRegime === 'bullish') bullishCount++;
    else if (state.trendRegime === 'bearish') bearishCount++;
    else rangeCount++;

    for (const event of state.activeEvents) {
      allEvents.push({
        event,
        symbol: state.symbol,
        timeframe: state.timeframe,
      });
    }

    if (state.activeEvents.length > 0) {
      activity.push({
        symbol: state.symbol,
        timeframe: state.timeframe,
        eventCount: state.activeEvents.length,
        latestEventType: state.activeEvents[0]!.type,
      });
    }
  }

  // Sort events newest-first by availableAtTimestamp.
  allEvents.sort(
    (a, b) => b.event.availableAtTimestamp - a.event.availableAtTimestamp,
  );

  // Sort activity by event count descending.
  activity.sort((a, b) => b.eventCount - a.eventCount);

  const totalSymbols = streamStates.size;
  const breadth: MarketBreadth = {
    bullishCount,
    bearishCount,
    rangeCount,
    totalSymbols,
    bullishRatio: totalSymbols > 0 ? bullishCount / totalSymbols : 0,
    bearishRatio: totalSymbols > 0 ? bearishCount / totalSymbols : 0,
  };

  return {
    updatedAt: Date.now(),
    streams: streamStates,
    allEvents,
    breadth,
    hotSymbols: activity.slice(0, topN),
  };
}
