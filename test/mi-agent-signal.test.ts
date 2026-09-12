import { describe, expect, it } from 'vitest';
import { buildMiFvgTradingSignal } from '../src/engines/mi-agent-signal.js';
import type { EvidenceSnapshot } from '../src/engines/mi-evidence.js';
import type { ResearchResult } from '@nemesis-oss/market-research';

function fvgResult(): ResearchResult {
  return {
    population: { symbol: 'BTCUSDT', timeframe: '1h', candleCount: 300 },
    sample: { eventType: 'fvg', sampleSize: 50, effectiveSampleSize: 40, clusterCount: 5 },
    controls: { sampleSize: 50, matchedHitRateR2: 0.3, matchRatio: 0.8 },
    descriptive: {
      reachRates: { r1: 0.6, r2: 0.55, r3: 0.3 },
      hitRates: { r1: 0.6, r2: 0.55, r3: 0.3 },
      medianMfeAtr: 1,
      medianMaeAtr: 0.7,
      retestProbability: null,
      fill25Rate: null,
      fill50Rate: null,
      fullFillRate: null,
    },
    effect: { uplift: 0.25, relativeUplift: 0.8, oddsRatio: 2.5 },
    uncertainty: {},
    dependence: {
      clusterCount: 5,
      effectiveSampleSize: 40,
      pValueEstimate: 0.02,
      isStatisticallySignificant: true,
      isFdrSignificant: true,
    },
    provenance: {
      datasetId: 'x',
      datasetHash: 'h',
      detectorId: 'fvg',
      detectorVersion: '1',
      detectorConfigHash: 'c',
      outcomeConfigHash: 'o',
      outcomeVersion: '1',
    },
    evidenceStatus: 'exploratory',
  };
}

describe('buildMiFvgTradingSignal', () => {
  it('maps evidence snapshot + agent status to read-only FVG signal', () => {
    const snap: EvidenceSnapshot = {
      symbol: 'BTCUSDT',
      timeframe: '1h',
      refreshedAt: Date.now(),
      candleCount: 300,
      results: [fvgResult()],
    };
    const signal = buildMiFvgTradingSignal({
      evidence: snap,
      agentOutcome: { status: 'ACHIEVED', report: 'FVG uplift confirmed.' },
      walkForwardStable: true,
    });
    expect(signal?.kind).toBe('fvg_evidence');
    expect(signal?.readOnly).toBe(true);
    expect(signal?.mayConsiderSetup).toBe(true);
    expect(signal?.agentRunStatus).toBe('ACHIEVED');
  });
});
