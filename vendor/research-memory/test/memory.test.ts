import { describe, it, expect } from 'vitest';
import type { Hypothesis, HypothesisResult } from '@nemesis-oss/hypothesis-engine';
import type { StrategyCandidate } from '@nemesis-oss/strategy-discovery';

import { createResearchMemory, computeDatasetHash } from '../src/memory.js';

function makeHypothesis(id: string, symbol = 'BTCUSDT'): Hypothesis {
  return {
    id,
    description: `Test ${id}`,
    symbol,
    timeframe: '15m',
    eventType: 'fvg',
  };
}

function makeResult(verdict: HypothesisResult['verdict']): HypothesisResult {
  return {
    hypothesis: makeHypothesis('h1'),
    verdict,
    sampleSize: 100,
    reachRate: 0.4,
    baselineRate: 0.3,
    uplift: 0.1,
    pValue: 0.02,
    isFdrSignificant: true,
    evidenceSummary: 'Test',
    testedAt: Date.now(),
  };
}

describe('research-memory / ResearchMemory', () => {
  it('records and retrieves experiments', () => {
    const mem = createResearchMemory();
    const h = makeHypothesis('h1');
    mem.recordExperiment({
      id: 'exp-1',
      hypothesis: h,
      result: makeResult('validated'),
      createdAt: Date.now(),
    });

    expect(mem.experimentCount).toBe(1);
    const prior = mem.findPriorTest(h);
    expect(prior).not.toBeNull();
    expect(prior!.id).toBe('exp-1');
  });

  it('finds prior tests by hypothesis key (dedup)', () => {
    const mem = createResearchMemory();
    const h1 = makeHypothesis('h1');
    const h2 = makeHypothesis('h2'); // same symbol/timeframe/eventType → same key
    mem.recordExperiment({
      id: 'exp-1',
      hypothesis: h1,
      result: makeResult('validated'),
      createdAt: Date.now() - 1000,
    });
    mem.recordExperiment({
      id: 'exp-2',
      hypothesis: h2,
      result: makeResult('rejected'),
      createdAt: Date.now(),
    });

    // findPriorTest should return the most recent (exp-2).
    const prior = mem.findPriorTest(h1);
    expect(prior!.id).toBe('exp-2');
  });

  it('returns null when no prior test exists', () => {
    const mem = createResearchMemory();
    expect(mem.findPriorTest(makeHypothesis('h1'))).toBeNull();
  });

  it('records and queries datasets', () => {
    const mem = createResearchMemory();
    const hash = computeDatasetHash('BTCUSDT', '15m', 500, 1, 2);
    mem.recordDataset({
      id: 'ds-1',
      symbol: 'BTCUSDT',
      timeframe: '15m',
      candleCount: 500,
      startTime: 1,
      endTime: 2,
      hash,
      createdAt: Date.now(),
    });

    const found = mem.findDataset('BTCUSDT', '15m', hash);
    expect(found).toBeDefined();
    expect(found!.id).toBe('ds-1');
  });

  it('records and queries validated strategies', () => {
    const mem = createResearchMemory();
    const candidate: StrategyCandidate = {
      id: 'strat-1',
      hypothesis: makeHypothesis('h1'),
      result: makeResult('validated'),
      entryConditions: [],
      contextConditions: [],
      invalidation: { type: 'stop_loss', parameters: {}, description: '' },
      targetModel: { targetR: 2, stopAtrMultiplier: 1.5, horizonCandles: 24 },
      sampleSize: 100,
      expectancyR: 0.2,
      winRate: 0.4,
      confidenceInterval: { lower: 0.3, upper: 0.5 },
      baselineComparison: { baseline: 0.3, uplift: 0.1 },
      robustness: { level: 'high', score: 0.8, factors: [] },
      provenance: { createdAt: Date.now(), engineVersion: '0.1.0' },
    };
    mem.recordStrategy(candidate);

    expect(mem.strategyCount).toBe(1);
    expect(mem.validatedStrategies().length).toBe(1);
  });

  it('filters rejected experiments', () => {
    const mem = createResearchMemory();
    mem.recordExperiment({
      id: 'exp-1',
      hypothesis: makeHypothesis('h1'),
      result: makeResult('validated'),
      createdAt: Date.now(),
    });
    mem.recordExperiment({
      id: 'exp-2',
      hypothesis: makeHypothesis('h2', 'ETHUSDT'),
      result: makeResult('rejected'),
      createdAt: Date.now(),
    });

    expect(mem.rejectedExperiments().length).toBe(1);
    expect(mem.experimentsBySymbol('ETHUSDT').length).toBe(1);
  });

  it('computes deterministic dataset hashes', () => {
    const h1 = computeDatasetHash('BTCUSDT', '15m', 500, 1, 2);
    const h2 = computeDatasetHash('BTCUSDT', '15m', 500, 1, 2);
    const h3 = computeDatasetHash('ETHUSDT', '15m', 500, 1, 2);
    expect(h1).toBe(h2);
    expect(h1).not.toBe(h3);
  });
});
