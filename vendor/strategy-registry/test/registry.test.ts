import { describe, it, expect } from 'vitest';
import type { StrategyCandidate } from '@nemesis-oss/strategy-discovery';

import { createStrategyRegistry } from '../src/registry.js';

function makeCandidate(id: string, symbol = 'BTCUSDT'): StrategyCandidate {
  return {
    id,
    hypothesis: {
      id: `hyp-${id}`,
      description: `Test ${id}`,
      symbol,
      timeframe: '15m',
      eventType: 'fvg',
    },
    result: {
      hypothesis: {
        id: `hyp-${id}`,
        description: `Test ${id}`,
        symbol,
        timeframe: '15m',
        eventType: 'fvg',
      },
      verdict: 'validated',
      sampleSize: 100,
      reachRate: 0.45,
      baselineRate: 0.35,
      uplift: 0.1,
      pValue: 0.02,
      isFdrSignificant: true,
      evidenceSummary: 'Validated',
      testedAt: Date.now(),
    },
    entryConditions: [],
    contextConditions: [],
    invalidation: { type: 'stop_loss', parameters: {}, description: '1.5 ATR' },
    targetModel: { targetR: 2, stopAtrMultiplier: 1.5, horizonCandles: 24 },
    sampleSize: 100,
    expectancyR: 0.2,
    winRate: 0.45,
    confidenceInterval: { lower: 0.35, upper: 0.55 },
    baselineComparison: { baseline: 0.35, uplift: 0.1 },
    robustness: { level: 'high', score: 0.8, factors: ['large_sample'] },
    provenance: { createdAt: Date.now(), engineVersion: '0.1.0' },
  };
}

describe('strategy-registry / StrategyRegistry', () => {
  it('registers a new strategy candidate', () => {
    const reg = createStrategyRegistry();
    const candidate = makeCandidate('s1');
    const entry = reg.register(candidate);

    expect(entry.id).toBe('s1');
    expect(entry.status).toBe('DISCOVERED');
    expect(entry.history.length).toBe(0);
  });

  it('throws on duplicate registration', () => {
    const reg = createStrategyRegistry();
    reg.register(makeCandidate('s1'));
    expect(() => reg.register(makeCandidate('s1'))).toThrow(/already registered/);
  });

  it('transitions through the lifecycle', () => {
    const reg = createStrategyRegistry();
    const entry = reg.register(makeCandidate('s1'));

    reg.transition('s1', 'RESEARCHED');
    reg.transition('s1', 'BACKTESTED');
    reg.transition('s1', 'WFO_VALIDATED');
    reg.transition('s1', 'OOS_VALIDATED');
    reg.transition('s1', 'PAPER');
    reg.transition('s1', 'PROMOTED');
    reg.transition('s1', 'ACTIVE');

    const final = reg.get('s1')!;
    expect(final.status).toBe('ACTIVE');
    expect(final.history.length).toBe(7);
  });

  it('throws on invalid transition', () => {
    const reg = createStrategyRegistry();
    reg.register(makeCandidate('s1'));
    expect(() => reg.transition('s1', 'ACTIVE')).toThrow(/Invalid transition/);
  });

  it('allows retirement from any active state', () => {
    const reg = createStrategyRegistry();
    reg.register(makeCandidate('s1'));
    reg.transition('s1', 'RESEARCHED');
    reg.transition('s1', 'RETIRED');
    expect(reg.get('s1')!.status).toBe('RETIRED');
  });

  it('queries by status and symbol', () => {
    const reg = createStrategyRegistry();
    reg.register(makeCandidate('s1', 'BTCUSDT'));
    reg.register(makeCandidate('s2', 'ETHUSDT'));
    reg.register(makeCandidate('s3', 'BTCUSDT'));

    const active = reg.byStatus('DISCOVERED');
    expect(active.length).toBe(3);

    const btc = reg.bySymbol('BTCUSDT');
    expect(btc.length).toBe(2);
  });

  it('updates metrics', () => {
    const reg = createStrategyRegistry();
    reg.register(makeCandidate('s1'));
    const updated = reg.updateMetrics('s1', { liveTrades: 10, liveWinRate: 0.5 });
    expect(updated.metrics.liveTrades).toBe(10);
  });

  it('counts by status', () => {
    const reg = createStrategyRegistry();
    reg.register(makeCandidate('s1'));
    reg.register(makeCandidate('s2'));
    reg.transition('s1', 'RESEARCHED');

    const counts = reg.countByStatus();
    expect(counts.get('DISCOVERED')).toBe(1);
    expect(counts.get('RESEARCHED')).toBe(1);
  });
});
