import type { AlertClass, AlertSeverity } from '../../domain/alerts/types.js';

export interface AlertSubscriptions {
  readonly classes: Readonly<Record<AlertClass, boolean>>;
  readonly symbols: Readonly<Record<string, boolean>>;
  readonly minSeverity: AlertSeverity;
  readonly levelApproaching: boolean;
  readonly liquiditySweeps: boolean;
  readonly setupDeveloping: boolean;
  readonly minimumSignalConfidence: number;
  readonly minimumRr: number;
  readonly researchReports: 'off' | 'daily';
}

export const defaultSubscriptions = (): AlertSubscriptions => ({
  classes: {
    SYSTEM: true,
    MACRO: true,
    MARKET: true,
    LEVEL: true,
    SETUP: true,
    SIGNAL: true,
    TRADE: true,
    RESEARCH: true,
  },
  symbols: {},
  minSeverity: 'WATCH',
  levelApproaching: false,
  liquiditySweeps: true,
  setupDeveloping: true,
  minimumSignalConfidence: Number(process.env.COUNCIL_LLM_MIN_CONFIDENCE ?? 0.75),
  minimumRr: Number(process.env.RISK_MIN_RR ?? 2.5),
  researchReports: 'daily',
});

const asRecord = (v: unknown): Record<string, unknown> =>
  v !== null && typeof v === 'object' ? v as Record<string, unknown> : {};

const parseClasses = (
  raw: Record<string, unknown>,
  base: AlertSubscriptions['classes']
): AlertSubscriptions['classes'] => {
  const next = { ...base };
  for (const key of Object.keys(next) as AlertClass[]) {
    if (typeof raw[key.toLowerCase()] === 'boolean') next[key] = raw[key.toLowerCase()] as boolean;
    if (typeof raw[key] === 'boolean') next[key] = raw[key] as boolean;
  }
  return next;
};

const parseSymbols = (raw: unknown): Record<string, boolean> => {
  const src = asRecord(raw);
  const out: Record<string, boolean> = {};
  for (const [k, v] of Object.entries(src)) {
    const enabled = typeof v === 'boolean' ? v : asRecord(v).enabled;
    if (typeof enabled === 'boolean') out[k.toUpperCase()] = enabled;
  }
  return out;
};

/** Merge operator JSON (NOTIFICATIONS_JSON or file) onto defaults. */
export const parseSubscriptions = (raw: unknown): AlertSubscriptions => {
  const d = defaultSubscriptions();
  const obj = asRecord(raw);
  const notes = asRecord(obj.notifications ?? obj);
  return {
    classes: parseClasses(notes, d.classes),
    symbols: parseSymbols(notes.symbols ?? obj.symbols),
    minSeverity: typeof notes.minSeverity === 'string' ? notes.minSeverity as AlertSeverity : d.minSeverity,
    levelApproaching: typeof notes.level_approaching === 'boolean'
      ? notes.level_approaching : d.levelApproaching,
    liquiditySweeps: typeof notes.liquidity_sweeps === 'boolean'
      ? notes.liquidity_sweeps : d.liquiditySweeps,
    setupDeveloping: typeof notes.setup_developing === 'boolean'
      ? notes.setup_developing : d.setupDeveloping,
    minimumSignalConfidence: typeof notes.minimum_signal_confidence === 'number'
      ? notes.minimum_signal_confidence : d.minimumSignalConfidence,
    minimumRr: typeof notes.minimum_rr === 'number' ? notes.minimum_rr : d.minimumRr,
    researchReports: notes.research_reports === 'off' ? 'off' : 'daily',
  };
};
