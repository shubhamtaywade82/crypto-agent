/**
 * Build an {@link AggregatedMarketState} from a map of per-stream states.
 *
 * Pure function: no side effects, no async. Safe to call on every stream
 * update. The output is immutable.
 */
export function aggregateMarketState(streamStates, options = {}) {
    const topN = options.topN ?? 5;
    let bullishCount = 0;
    let bearishCount = 0;
    let rangeCount = 0;
    const allEvents = [];
    const activity = [];
    for (const [key, state] of streamStates) {
        if (state.trendRegime === 'bullish')
            bullishCount++;
        else if (state.trendRegime === 'bearish')
            bearishCount++;
        else
            rangeCount++;
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
                latestEventType: state.activeEvents[0].type,
            });
        }
    }
    // Sort events newest-first by availableAtTimestamp.
    allEvents.sort((a, b) => b.event.availableAtTimestamp - a.event.availableAtTimestamp);
    // Sort activity by event count descending.
    activity.sort((a, b) => b.eventCount - a.eventCount);
    const totalSymbols = streamStates.size;
    const breadth = {
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
//# sourceMappingURL=aggregator.js.map