import { describe, expect, it } from 'vitest';
import type { ResearchResult } from '@nemesis-oss/market-research';
import type { EvidenceSnapshot } from '../src/engines/mi-evidence.js';
import { verdictForSetup } from '../src/engines/mi-evidence-gate.js';

const mockSnap = (rows: ResearchResult[]): EvidenceSnapshot => ({
  symbol: 'SOLUSDT', timeframe: '1h', refreshedAt: Date.now(), candleCount: 300, results: rows,
});

const row = (eventType: string, status: ResearchResult['evidenceStatus']): ResearchResult => ({
  population: { symbol: 'SOLUSDT', timeframe: '1h', candleCount: 300 },
  sample: { eventType, sampleSize: 40, effectiveSampleSize: 30, clusterCount: 5 },
  controls: { sampleSize: 40, matchedHitRateR2: 0.4, matchRatio: 0.9 },
  descriptive: {
    reachRates: { r1: 0.6, r2: 0.5, r3: 0.3 }, hitRates: { r1: 0.6, r2: 0.5, r3: 0.3 },
    medianMfeAtr: 1, medianMaeAtr: 0.8,
    retestProbability: null, fill25Rate: null, fill50Rate: null, fullFillRate: null,
  },
  effect: { uplift: 0.1 },
  uncertainty: {},
  dependence: { clusterCount: 5, effectiveSampleSize: 30, pValueEstimate: 0.04, isStatisticallySignificant: true },
  provenance: {
    datasetId: 'x', datasetHash: 'x', detectorId: eventType, detectorVersion: '1',
    detectorConfigHash: 'x', outcomeConfigHash: 'x', outcomeVersion: '1',
  },
  evidenceStatus: status,
});

describe('verdictForSetup', () => {
  it('allows robust liquidity sweep evidence for LIQUIDITY_SWEEP_REVERSAL', () => {
    const v = verdictForSetup(
      mockSnap([row('liquidity_sweep', 'robust')]),
      'LIQUIDITY_SWEEP_REVERSAL'
    );
    expect(v.allowed).toBe(true);
    expect(v.status).toBe('robust');
  });

  it('blocks confounded mapped events', () => {
    const v = verdictForSetup(
      mockSnap([row('liquidity_sweep', 'confounded')]),
      'LIQUIDITY_SWEEP_REVERSAL'
    );
    expect(v.allowed).toBe(false);
    expect(v.reason).toContain('confounded');
  });

  it('blocks insufficient_sample mapped events', () => {
    const v = verdictForSetup(
      mockSnap([row('bos', 'insufficient_sample')]),
      'BREAKOUT_RETEST'
    );
    expect(v.allowed).toBe(false);
    expect(v.reason).toContain('insufficient_sample');
  });

  it('fails open when no study snapshot exists', () => {
    expect(verdictForSetup(undefined, 'TREND_CONTINUATION').allowed).toBe(true);
  });
});
