import { describe, it, expect } from 'vitest';
import type { MarketState as StreamMarketState } from '@nemesis-oss/market-stream';

import { aggregateMarketState } from '../src/aggregator.js';

function makeState(
  symbol: string,
  trend: 'bullish' | 'bearish' | 'range',
  eventCount: number = 0,
): StreamMarketState {
  return {
    symbol,
    timeframe: '15m',
    timestamp: Date.now(),
    price: '100',
    candleCount: 100,
    trendRegime: trend,
    volatilityRegime: 'normal',
    atr: '1.5',
    session: 'new_york',
    activeEvents: Array.from({ length: eventCount }, (_, i) => ({
      id: `${symbol}-ev-${i}`,
      type: 'fvg',
      symbol,
      timeframe: '15m',
      direction: 'bullish',
      detectedAt: Date.now(),
      originIndex: 90 + i,
      originTimestamp: Date.now() - (eventCount - i) * 1000,
      availableAtIndex: 95 + i,
      availableAtTimestamp: Date.now() - (eventCount - i) * 500,
    })),
    updatedAt: Date.now(),
  };
}

describe('market-state / aggregateMarketState', () => {
  it('computes market breadth across multiple symbols', () => {
    const streams = new Map<string, StreamMarketState>([
      ['BTCUSDT:15m', makeState('BTCUSDT', 'bullish', 3)],
      ['ETHUSDT:15m', makeState('ETHUSDT', 'bullish', 1)],
      ['SOLUSDT:15m', makeState('SOLUSDT', 'bearish', 2)],
      ['XRPUSDT:15m', makeState('XRPUSDT', 'range', 0)],
    ]);

    const agg = aggregateMarketState(streams);

    expect(agg.breadth.totalSymbols).toBe(4);
    expect(agg.breadth.bullishCount).toBe(2);
    expect(agg.breadth.bearishCount).toBe(1);
    expect(agg.breadth.rangeCount).toBe(1);
    expect(agg.breadth.bullishRatio).toBeCloseTo(0.5, 1);
  });

  it('collects all events across streams, sorted newest-first', () => {
    const streams = new Map<string, StreamMarketState>([
      ['BTCUSDT:15m', makeState('BTCUSDT', 'bullish', 2)],
      ['ETHUSDT:15m', makeState('ETHUSDT', 'bearish', 1)],
    ]);

    const agg = aggregateMarketState(streams);

    expect(agg.allEvents.length).toBe(3);
    // Verify sorted by availableAtTimestamp descending.
    for (let i = 1; i < agg.allEvents.length; i++) {
      const prev = agg.allEvents[i - 1]!;
      const curr = agg.allEvents[i]!;
      expect(prev.event.availableAtTimestamp).toBeGreaterThanOrEqual(
        curr.event.availableAtTimestamp,
      );
    }
  });

  it('ranks hot symbols by event count', () => {
    const streams = new Map<string, StreamMarketState>([
      ['BTCUSDT:15m', makeState('BTCUSDT', 'bullish', 5)],
      ['ETHUSDT:15m', makeState('ETHUSDT', 'bullish', 3)],
      ['SOLUSDT:15m', makeState('SOLUSDT', 'bearish', 8)],
      ['XRPUSDT:15m', makeState('XRPUSDT', 'range', 0)],
    ]);

    const agg = aggregateMarketState(streams, { topN: 2 });

    expect(agg.hotSymbols.length).toBe(2);
    expect(agg.hotSymbols[0]!.symbol).toBe('SOLUSDT');
    expect(agg.hotSymbols[0]!.eventCount).toBe(8);
    expect(agg.hotSymbols[1]!.symbol).toBe('BTCUSDT');
  });

  it('handles empty input', () => {
    const agg = aggregateMarketState(new Map());
    expect(agg.breadth.totalSymbols).toBe(0);
    expect(agg.allEvents.length).toBe(0);
    expect(agg.hotSymbols.length).toBe(0);
    expect(agg.breadth.bullishRatio).toBe(0);
  });

  it('produces JSON-serializable output', () => {
    const streams = new Map<string, StreamMarketState>([
      ['BTCUSDT:15m', makeState('BTCUSDT', 'bullish', 1)],
    ]);
    const agg = aggregateMarketState(streams);
    const json = JSON.stringify(agg);
    expect(json.length).toBeGreaterThan(0);
  });
});
