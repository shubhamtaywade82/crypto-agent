/** Canonical alert taxonomy for the 24/7 monitoring layer. */

export const ALERT_CLASSES = [
  'SYSTEM', 'MACRO', 'MARKET', 'LEVEL', 'SETUP', 'SIGNAL', 'TRADE', 'RESEARCH',
] as const;
export type AlertClass = (typeof ALERT_CLASSES)[number];

export const ALERT_SEVERITIES = [
  'INFO', 'WATCH', 'IMPORTANT', 'SIGNAL', 'CRITICAL',
] as const;
export type AlertSeverity = (typeof ALERT_SEVERITIES)[number];

export const SETUP_PHASES = [
  'NONE', 'WATCHING', 'APPROACHING', 'ZONE_REACHED', 'TRIGGER_DETECTED',
  'CONFIRMING', 'CONFIRMED', 'INVALIDATED', 'EXPIRED',
] as const;
export type SetupPhase = (typeof SETUP_PHASES)[number];

export const SEVERITY_RANK: Readonly<Record<AlertSeverity, number>> = {
  INFO: 0,
  WATCH: 1,
  IMPORTANT: 2,
  SIGNAL: 3,
  CRITICAL: 4,
};

export interface AlertEvent {
  readonly id: string;
  readonly at: number;
  readonly class: AlertClass;
  readonly severity: AlertSeverity;
  readonly symbol?: string;
  readonly title: string;
  readonly body: string;
  readonly fingerprint: string;
  readonly stateFrom?: string;
  readonly stateTo?: string;
  readonly payload: Readonly<Record<string, unknown>>;
}

export type AlertAction = 'emitted' | 'suppressed';

export type AlertSuppressReason =
  | 'CLASS'
  | 'SYMBOL'
  | 'SEVERITY'
  | 'LEVEL_APPROACHING'
  | 'CONFIDENCE'
  | 'RR'
  | 'DEDUPE'
  | 'COOLDOWN'
  | 'MASTER';

export interface AlertDecision {
  readonly action: AlertAction;
  readonly reason?: AlertSuppressReason;
  readonly event: AlertEvent;
}
