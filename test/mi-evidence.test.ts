import { describe, expect, it } from 'vitest';
import type { ResearchResult } from '@nemesis-oss/market-research';
import {
  eventTypesForCouncil,
  formatEvidenceBlock,
  formatEvidenceLine,
  pickEvidenceResults,
  type EvidenceSnapshot,
} from '../src/engines/mi-evidence.js';

const mockResult = (eventType: string, status: ResearchResult['evidenceStatus']): ResearchResult => ({
  population: { symbol: 'SOLUSDT', timeframe: '1h', candleCount: 300 },
  sample: { eventType, sampleSize: 45, effectiveSampleSize: 30, clusterCount: 8 },
  controls: { sampleSize: 45, matchedHitRateR2: 0.41, matchRatio: 0.9 },
  descriptive: {
    reachRates: { r1: 0.7, r2: 0.58, r3: 0.4 },
    hitRates: { r1: 0.7, r2: 0.58, r3: 0.4 },
    medianMfeAtr: 1.2, medianMaeAtr: 0.8,
    retestProbability: null, fill25Rate: null, fill50Rate: null, fullFillRate: null,
  },
  effect: { uplift: 0.17, oddsRatio: 1.4 },
  uncertainty: {},
  dependence: {
    clusterCount: 8, effectiveSampleSize: 30, pValueEstimate: 0.03,
    isStatisticallySignificant: true, isFdrSignificant: true,
  },
  provenance: {
    datasetId: 'SOL-1h', datasetHash: 'x', detectorId: eventType,
    detectorVersion: '1.0.0', detectorConfigHash: 'x', outcomeConfigHash: 'x', outcomeVersion: '1.0.0',
  },
  evidenceStatus: status,
});

describe('mi-evidence', () => {
  it('formats reach rates and evidence status', () => {
    const line = formatEvidenceLine(mockResult('liquidity_sweep', 'robust'));
    expect(line).toContain('liquidity_sweep');
    expect(line).toContain('58%');
    expect(line).toContain('status=robust');
  });

  it('picks event types for market-event triggers', () => {
    const types = eventTypesForCouncil({
      type: 'MARKET_EVENT', symbol: 'SOLUSDT', timeframe: '1h',
      eventType: 'liquidity_sweep', eventId: 'e1', direction: 'bearish', label: 'sweep',
    }, []);
    expect(types).toEqual(['liquidity_sweep']);
  });

  it('builds evidence block from snapshot', () => {
    const snap: EvidenceSnapshot = {
      symbol: 'SOLUSDT', timeframe: '1h', refreshedAt: Date.now(), candleCount: 300,
      results: [mockResult('choch', 'exploratory'), mockResult('bos', 'descriptive_only')],
    };
    const block = formatEvidenceBlock(pickEvidenceResults(snap, ['choch', 'bos']));
    expect(block).toContain('choch');
    expect(block).toContain('bos');
  });
});
