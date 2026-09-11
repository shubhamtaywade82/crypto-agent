import type { Timeframe } from '@nemesis-oss/market-events';
import type { FvgOutcome, ResearchObservation } from './types.js';

export interface NegativeEvidenceFlags {
  readonly hasHtfConflict: boolean;
  readonly isEarlyFailure: boolean;
  readonly isInvalidatedZone: boolean;
  readonly hasCounterTrendRegime: boolean;
}

export function checkHtfConflict(obs: ResearchObservation, htf: Timeframe = '1h'): boolean {
  const htfTrend = obs.context.htfContext?.[htf]?.trend;
  if (!htfTrend || htfTrend === 'sideways') return false;

  const eventDir = obs.event.direction;
  return (eventDir === 'bullish' && htfTrend === 'bearish') ||
         (eventDir === 'bearish' && htfTrend === 'bullish');
}

export function checkEarlyFailure(obs: ResearchObservation, maxBars: number = 3): boolean {
  return obs.outcome.firstHit === 'stop_first' && obs.outcome.timeToFirstHitBars <= maxBars;
}

export function checkInvalidatedZone(obs: ResearchObservation): boolean {
  if ('isInvalidated' in obs.outcome) {
    return (obs.outcome as FvgOutcome).isInvalidated;
  }
  return false;
}

export function classifyNegativeEvidence(
  obs: ResearchObservation,
  htf: Timeframe = '1h',
  maxBarsForEarlyFail: number = 3
): NegativeEvidenceFlags {
  const eventDir = obs.event.direction;
  const localTrend = obs.context.trendRegime;
  const hasCounterTrend = (eventDir === 'bullish' && localTrend === 'bearish') ||
                          (eventDir === 'bearish' && localTrend === 'bullish');

  return {
    hasHtfConflict: checkHtfConflict(obs, htf),
    isEarlyFailure: checkEarlyFailure(obs, maxBarsForEarlyFail),
    isInvalidatedZone: checkInvalidatedZone(obs),
    hasCounterTrendRegime: hasCounterTrend
  };
}

export interface NegativeEvidenceImpactResult {
  readonly sampleSize: number;
  readonly alignedCount: number;
  readonly conflictedCount: number;
  readonly alignedHitRateR2: number;
  readonly conflictedHitRateR2: number;
  readonly conflictPenalty: number;
  readonly earlyFailureRate: number;
  readonly netEvidenceScore: number;
}

/**
 * Measures the degradation in empirical hit rate caused by contradictory or negative evidence.
 */
export function evaluateNegativeEvidenceImpact(
  observations: readonly ResearchObservation[],
  htf: Timeframe = '1h'
): NegativeEvidenceImpactResult {
  const n = observations.length;
  if (n === 0) {
    return {
      sampleSize: 0, alignedCount: 0, conflictedCount: 0,
      alignedHitRateR2: 0, conflictedHitRateR2: 0, conflictPenalty: 0,
      earlyFailureRate: 0, netEvidenceScore: 0
    };
  }

  const conflicted = observations.filter(o => checkHtfConflict(o, htf));
  const aligned = observations.filter(o => !checkHtfConflict(o, htf));
  const earlyFails = observations.filter(o => checkEarlyFailure(o, 3));

  const alignedHits = aligned.filter(o => o.outcome.hit2R).length;
  const conflictedHits = conflicted.filter(o => o.outcome.hit2R).length;

  const alignedRate = aligned.length > 0 ? alignedHits / aligned.length : 0;
  const conflictedRate = conflicted.length > 0 ? conflictedHits / conflicted.length : 0;

  return {
    sampleSize: n,
    alignedCount: aligned.length,
    conflictedCount: conflicted.length,
    alignedHitRateR2: alignedRate,
    conflictedHitRateR2: conflictedRate,
    conflictPenalty: conflictedRate - alignedRate,
    earlyFailureRate: earlyFails.length / n,
    netEvidenceScore: (aligned.length - conflicted.length) / n
  };
}
