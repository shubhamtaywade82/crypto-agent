import type { TradeDirection } from '../domain/primitives.js';

/** Frozen copy of the live LLM/setup confidence default. Do not read from env. */
export const FUNNEL_CONFIDENCE_THRESHOLD = 0.75;

export const FUNNEL_GATE_IDS = [
  'observations',
  'macro',
  'bias',
  'structure',
  'liquidity',
  'zone',
  'retest',
  'trigger',
  'confluence',
  'rr',
  'risk',
  'executable',
] as const;
export type FunnelGateId = (typeof FUNNEL_GATE_IDS)[number];

export interface GateResult {
  readonly observed: boolean;
  readonly passed: boolean;
  readonly reason?: string;
}

export interface SetupFunnelObservation {
  readonly timestamp: number;
  readonly symbol: string;
  readonly direction: TradeDirection;
  readonly macro: GateResult;
  readonly bias: GateResult;
  readonly structure: GateResult;
  readonly liquidity: GateResult;
  readonly zone: GateResult;
  readonly retest: GateResult;
  readonly trigger: GateResult;
  readonly confluence: {
    readonly score?: number;
    readonly threshold: number;
    readonly passed: boolean;
  };
  readonly rr: {
    readonly value?: number;
    readonly threshold: number;
    readonly passed: boolean;
  };
  readonly risk: GateResult;
  readonly final: {
    readonly executable: boolean;
    readonly rejectionReason?: string;
  };
}

export interface FunnelGateStats {
  readonly id: FunnelGateId;
  readonly seen: number;
  readonly passed: number;
  readonly passRate: number;
  readonly note?: string;
}

export interface FunnelReport {
  readonly symbol: string;
  readonly observations: number;
  readonly gates: readonly FunnelGateStats[];
  readonly rejectionReasons: Readonly<Record<string, number>>;
  readonly deadGate?: FunnelGateId;
  readonly executable: number;
  /** Sample of non-executable bars (capped) for "why this month produced zero trades". */
  readonly samples: readonly SetupFunnelObservation[];
}
