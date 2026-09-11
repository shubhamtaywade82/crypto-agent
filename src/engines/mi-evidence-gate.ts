import type { EvidenceStatus } from '@nemesis-oss/market-research';
import type { SetupType } from './setup-engine.js';
import { pickEvidenceResults, type EvidenceSnapshot } from './mi-evidence.js';
import { evidenceEnabled } from './mi-evidence-cache.js';

export interface EvidenceVerdict {
  readonly allowed: boolean;
  readonly reason?: string;
  readonly status?: EvidenceStatus;
}

const SETUP_EVENTS: Record<SetupType, readonly string[]> = {
  PULLBACK_RECLAIM: ['choch', 'order_block'],
  LIQUIDITY_SWEEP_REVERSAL: ['liquidity_sweep'],
  BREAKOUT_RETEST: ['bos', 'fvg'],
  TREND_CONTINUATION: ['bos', 'displacement'],
};

const BLOCKED: ReadonlySet<EvidenceStatus> = new Set([
  'confounded', 'insufficient_sample', 'descriptive_only',
]);

const ALLOWED: ReadonlySet<EvidenceStatus> = new Set([
  'robust', 'exploratory', 'oos_supported', 'train_supported',
]);

export const evidenceGateEnabled = (): boolean =>
  process.env.MI_EVIDENCE_GATE !== 'false' && evidenceEnabled();

const strictRobustOnly = (): boolean => process.env.MI_EVIDENCE_GATE_STRICT === 'true';

const isSetupType = (value: string): value is SetupType => value in SETUP_EVENTS;

const rank = (status: EvidenceStatus | undefined): number => {
  if (status === 'robust') return 5;
  if (status === 'oos_supported') return 4;
  if (status === 'exploratory' || status === 'train_supported') return 3;
  if (status === 'descriptive_only') return 1;
  return 0;
};

/** Gate verdict from cached market-research study for a kernel setup type. */
export const verdictForSetup = (
  snap: EvidenceSnapshot | undefined,
  setupType: string
): EvidenceVerdict => {
  if (!evidenceGateEnabled()) return { allowed: true };
  if (!isSetupType(setupType)) return { allowed: true, reason: 'unknown setup type' };
  if (!snap) return { allowed: true, reason: 'no evidence study (fail-open)' };

  const mapped = pickEvidenceResults(snap, SETUP_EVENTS[setupType]);
  if (mapped.length === 0) return { allowed: true, reason: 'no mapped events in study' };

  const blocker = mapped.find((r) => BLOCKED.has(r.evidenceStatus ?? 'descriptive_only'));
  if (blocker) {
    return {
      allowed: false,
      status: blocker.evidenceStatus,
      reason: `${blocker.sample.eventType} evidence ${blocker.evidenceStatus}`,
    };
  }

  const best = mapped.reduce((a, b) => rank(a.evidenceStatus) >= rank(b.evidenceStatus) ? a : b);
  const status = best.evidenceStatus ?? 'descriptive_only';
  if (strictRobustOnly() && status !== 'robust') {
    return { allowed: false, status, reason: `${best.sample.eventType} requires robust evidence` };
  }
  if (ALLOWED.has(status)) return { allowed: true, status };
  return { allowed: false, status, reason: `${best.sample.eventType} evidence ${status}` };
};
