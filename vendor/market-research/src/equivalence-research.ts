import type { BaseEvent, MarketEvent } from '@nemesis-oss/market-events';
import { normalCdf } from './statistical-significance.js';
import type { ResearchObservation } from './types.js';

export type CanonicalBehaviorType =
  | 'FAILED_DOWNSIDE_AUCTION'
  | 'FAILED_UPSIDE_AUCTION'
  | 'AGGRESSIVE_DIRECTIONAL_EXPANSION'
  | 'LIQUIDITY_IMBALANCE';

export interface CanonicalMapping {
  readonly canonicalType: CanonicalBehaviorType;
  readonly matchedEvents: readonly BaseEvent[];
  readonly representations: readonly string[];
  readonly timestamp: number;
}

export function mapToCanonicalEquivalence(events: readonly (BaseEvent | MarketEvent)[]): CanonicalMapping[] {
  const byTimestamp = new Map<number, (BaseEvent | MarketEvent)[]>();

  for (const e of events) {
    const list = byTimestamp.get(e.detectedAt) ?? [];
    list.push(e);
    byTimestamp.set(e.detectedAt, list);
  }

  const mappings: CanonicalMapping[] = [];

  for (const [timestamp, group] of byTimestamp.entries()) {
    const types = group.map(e => {
      const me = e as MarketEvent;
      if (me.type === 'liquidity_sweep') return 'SMC_SWEEP';
      if (me.type === 'wyckoff' && me.wyckoffType === 'spring') return 'WYCKOFF_SPRING';
      if (me.type === 'wyckoff' && me.wyckoffType === 'upthrust') return 'WYCKOFF_UPTHRUST';
      if (me.type === 'vsa' && me.vsaType === 'stopping_volume') return 'VSA_STOPPING_VOLUME';
      if (me.type === 'chart_pattern' && me.patternType === 'double_bottom') return 'CLASSICAL_DOUBLE_BOTTOM';
      return e.type.toUpperCase();
    });

    const isFailedDownside = group.some(e => {
      const me = e as MarketEvent;
      return (
        (me.type === 'liquidity_sweep' && me.targetType === 'ssl') ||
        (me.type === 'wyckoff' && me.wyckoffType === 'spring') ||
        (me.type === 'vsa' && me.vsaType === 'stopping_volume')
      );
    });

    if (isFailedDownside) {
      mappings.push({
        canonicalType: 'FAILED_DOWNSIDE_AUCTION',
        matchedEvents: group,
        representations: Array.from(new Set(types)),
        timestamp
      });
    }
  }

  return mappings;
}

export type EquivalenceConclusion = 'equivalent' | 'non-equivalent' | 'inconclusive';

export interface BehavioralEquivalenceResult {
  readonly sampleSizeA: number;
  readonly sampleSizeB: number;
  readonly hitRateA: number;
  readonly hitRateB: number;
  readonly absoluteDifference: number;
  readonly zScore: number;
  readonly pValue: number;
  readonly tostPValue: number;
  readonly tostZ1: number;
  readonly tostZ2: number;
  readonly confidenceInterval90: { readonly lower: number; readonly upper: number };
  readonly isBehaviorallyEquivalent: boolean;
  readonly equivalenceMargin: number;
  readonly conclusion: EquivalenceConclusion;
}

export function calculateTost(
  pA: number,
  nA: number,
  pB: number,
  nB: number,
  delta: number
): { z1: number; z2: number; tostPValue: number; se: number } {
  const diff = pA - pB;
  const varA = (pA * (1 - pA)) / nA;
  const varB = (pB * (1 - pB)) / nB;
  const se = Math.sqrt(varA + varB);

  if (se === 0) {
    const isEq = Math.abs(diff) < delta;
    return { z1: isEq ? 999 : -999, z2: isEq ? -999 : 999, tostPValue: isEq ? 0 : 1, se: 0 };
  }

  // Z1 tests H01: diff <= -delta
  const z1 = (diff + delta) / se;
  const p1 = 1 - normalCdf(z1);

  // Z2 tests H02: diff >= delta
  const z2 = (diff - delta) / se;
  const p2 = normalCdf(z2);

  return { z1, z2, tostPValue: Math.max(p1, p2), se };
}

function computeTostStats(pA: number, nA: number, pB: number, nB: number, delta: number, alpha: number) {
  const diff = Math.abs(pA - pB);
  const pooledP = (pA * nA + pB * nB) / (nA + nB);
  const pooledSe = Math.sqrt(pooledP * (1 - pooledP) * (1 / nA + 1 / nB));
  const zScore = pooledSe > 0 ? (pA - pB) / pooledSe : 0;
  const pValue = 2 * (1 - normalCdf(Math.abs(zScore)));
  const tost = calculateTost(pA, nA, pB, nB, delta);
  const z90 = 1.64485;
  const ci90 = { lower: (pA - pB) - z90 * tost.se, upper: (pA - pB) + z90 * tost.se };
  const isBehaviorallyEquivalent = tost.tostPValue <= alpha;
  const conclusion: EquivalenceConclusion = isBehaviorallyEquivalent
    ? 'equivalent'
    : pValue <= alpha ? 'non-equivalent' : 'inconclusive';

  return { diff, zScore, pValue, tost, ci90, isBehaviorallyEquivalent, conclusion };
}

export type EquivalenceMetric = 'reached1R' | 'reached2R' | 'reached3R' | 'hit1R' | 'hit2R' | 'hit3R';

/**
 * Formal Two One-Sided Tests (TOST) for behavioral equivalence between event families.
 * Categorizes findings into: equivalent, non-equivalent, or inconclusive.
 */
export function testOutcomeEquivalence(
  observationsA: readonly ResearchObservation[],
  observationsB: readonly ResearchObservation[],
  targetMetric: EquivalenceMetric = 'reached2R',
  equivalenceMargin: number = 0.08,
  alpha: number = 0.05
): BehavioralEquivalenceResult {
  const nA = observationsA.length;
  const nB = observationsB.length;
  if (nA === 0 || nB === 0) {
    return {
      sampleSizeA: nA, sampleSizeB: nB, hitRateA: 0, hitRateB: 0,
      absoluteDifference: 0, zScore: 0, pValue: 1.0, tostPValue: 1.0, tostZ1: 0, tostZ2: 0,
      confidenceInterval90: { lower: 0, upper: 0 },
      isBehaviorallyEquivalent: false, equivalenceMargin, conclusion: 'inconclusive'
    };
  }

  const pA = observationsA.filter(o => o.outcome[targetMetric]).length / nA;
  const pB = observationsB.filter(o => o.outcome[targetMetric]).length / nB;
  const s = computeTostStats(pA, nA, pB, nB, equivalenceMargin, alpha);

  return {
    sampleSizeA: nA, sampleSizeB: nB, hitRateA: pA, hitRateB: pB,
    absoluteDifference: s.diff, zScore: s.zScore, pValue: s.pValue,
    tostPValue: s.tost.tostPValue, tostZ1: s.tost.z1, tostZ2: s.tost.z2,
    confidenceInterval90: s.ci90, isBehaviorallyEquivalent: s.isBehaviorallyEquivalent,
    equivalenceMargin, conclusion: s.conclusion
  };
}

