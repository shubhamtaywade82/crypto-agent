import { describe, it, expect } from 'vitest';
import type { BaseEvent } from '@nemesis-oss/market-events';

import { buildEventGraph, discoverPatterns } from '../src/graph.js';

function makeEvent(
  type: string,
  index: number,
  direction: 'bullish' | 'bearish' = 'bullish',
): BaseEvent {
  return {
    id: `ev-${type}-${index}`,
    type: type as BaseEvent['type'],
    symbol: 'BTCUSDT',
    timeframe: '15m',
    direction,
    detectedAt: Date.now(),
    originIndex: index,
    originTimestamp: 1_700_000_000_000 + index * 60_000,
    availableAtIndex: index,
    availableAtTimestamp: 1_700_000_000_000 + index * 60_000,
  };
}

describe('event-graph / buildEventGraph', () => {
  it('builds nodes from multiple event types', () => {
    const events = new Map<string, readonly BaseEvent[]>([
      ['fvg', [makeEvent('fvg', 10), makeEvent('fvg', 20)]],
      ['bos', [makeEvent('bos', 12)]],
    ]);

    const graph = buildEventGraph(events, 'BTCUSDT', '15m');

    expect(graph.nodes.length).toBe(3);
    expect(graph.symbol).toBe('BTCUSDT');
  });

  it('builds edges between temporally proximate events', () => {
    const events = new Map<string, readonly BaseEvent[]>([
      ['fvg', [makeEvent('fvg', 10)]],
      ['liquidity_sweep', [makeEvent('liquidity_sweep', 12)]],
      ['mss', [makeEvent('mss', 14)]],
    ]);

    const graph = buildEventGraph(events, 'BTCUSDT', '15m', { maxBarGap: 5 });

    // fvg(10) → liquidity_sweep(12): gap=2 ✓
    // fvg(10) → mss(14): gap=4 ✓
    // liquidity_sweep(12) → mss(14): gap=2 ✓
    expect(graph.edges.length).toBe(3);

    const transitions = graph.edges.map((e) => e.transition);
    expect(transitions).toContain('fvg→liquidity_sweep');
    expect(transitions).toContain('fvg→mss');
    expect(transitions).toContain('liquidity_sweep→mss');
  });

  it('respects maxBarGap', () => {
    const events = new Map<string, readonly BaseEvent[]>([
      ['fvg', [makeEvent('fvg', 10)]],
      ['bos', [makeEvent('bos', 20)]], // gap=10, exceeds default maxBarGap=3
    ]);

    const graph = buildEventGraph(events, 'BTCUSDT', '15m');
    expect(graph.edges.length).toBe(0);
  });

  it('respects requireDirectionMatch', () => {
    const events = new Map<string, readonly BaseEvent[]>([
      ['fvg', [makeEvent('fvg', 10, 'bullish')]],
      ['bos', [makeEvent('bos', 12, 'bearish')]],
    ]);

    const graph = buildEventGraph(events, 'BTCUSDT', '15m', {
      maxBarGap: 5,
      requireDirectionMatch: true,
    });
    expect(graph.edges.length).toBe(0);
  });
});

describe('event-graph / discoverPatterns', () => {
  it('discovers length-2 patterns sorted by support', () => {
    const events = new Map<string, readonly BaseEvent[]>([
      ['fvg', [makeEvent('fvg', 10), makeEvent('fvg', 20), makeEvent('fvg', 30)]],
      ['sweep', [makeEvent('liquidity_sweep', 11), makeEvent('liquidity_sweep', 21)]],
      ['mss', [makeEvent('mss', 12)]],
    ]);

    const graph = buildEventGraph(events, 'BTCUSDT', '15m', { maxBarGap: 5 });
    const patterns = discoverPatterns(graph, 2, 2);

    expect(patterns.length).toBeGreaterThan(0);
    // "fvg→liquidity_sweep" should have the highest support (2 occurrences).
    const top = patterns[0]!;
    expect(top.support).toBeGreaterThanOrEqual(2);
  });

  it('discovers length-3 composite patterns', () => {
    const events = new Map<string, readonly BaseEvent[]>([
      ['fvg', [makeEvent('fvg', 10), makeEvent('fvg', 20)]],
      ['liquidity_sweep', [makeEvent('liquidity_sweep', 11), makeEvent('liquidity_sweep', 21)]],
      ['mss', [makeEvent('mss', 12), makeEvent('mss', 22)]],
    ]);

    const graph = buildEventGraph(events, 'BTCUSDT', '15m', { maxBarGap: 5 });
    const patterns = discoverPatterns(graph, 2, 3);

    // Should find "fvg→liquidity_sweep→mss" with support=2.
    const length3 = patterns.filter((p) => p.sequence.length === 3);
    expect(length3.length).toBeGreaterThan(0);
    const fvgSweepMss = length3.find((p) =>
      p.sequence.join('→') === 'fvg→liquidity_sweep→mss',
    );
    expect(fvgSweepMss).toBeDefined();
    expect(fvgSweepMss!.support).toBe(2);
  });
});
