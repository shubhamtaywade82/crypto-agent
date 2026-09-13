import {
  SEVERITY_RANK,
  type AlertClass,
  type AlertDecision,
  type AlertEvent,
  type AlertSuppressReason,
} from '../../domain/alerts/types.js';
import {
  defaultSubscriptions,
  type AlertSubscriptions,
} from './subscriptions.js';

const SYMBOL_SCOPED: ReadonlySet<AlertClass> = new Set([
  'MARKET', 'LEVEL', 'SETUP', 'SIGNAL',
]);

const numPayload = (event: AlertEvent, key: string): number | undefined => {
  const v = event.payload[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
};

const classDisabled = (event: AlertEvent, subs: AlertSubscriptions): boolean =>
  subs.classes[event.class] === false;

const symbolDisabled = (event: AlertEvent, subs: AlertSubscriptions): boolean => {
  if (!event.symbol || !SYMBOL_SCOPED.has(event.class)) return false;
  return subs.symbols[event.symbol.toUpperCase()] === false;
};

const belowSeverity = (event: AlertEvent, subs: AlertSubscriptions): boolean => {
  if (event.class === 'SYSTEM' && event.severity === 'CRITICAL') return false;
  return SEVERITY_RANK[event.severity] < SEVERITY_RANK[subs.minSeverity];
};

const approachingBlocked = (event: AlertEvent, subs: AlertSubscriptions): boolean =>
  event.class === 'LEVEL' && event.stateTo === 'APPROACHING' && !subs.levelApproaching;

const developingBlocked = (event: AlertEvent, subs: AlertSubscriptions): boolean =>
  event.class === 'SETUP' && event.stateTo === 'WATCHING' && !subs.setupDeveloping;

const sweepBlocked = (event: AlertEvent, subs: AlertSubscriptions): boolean =>
  !subs.liquiditySweeps && event.stateTo === 'REACTION';

const signalGate = (event: AlertEvent, subs: AlertSubscriptions): AlertSuppressReason | undefined => {
  if (event.class !== 'SIGNAL' || event.stateTo !== 'CONFIRMED') return undefined;
  const confidence = numPayload(event, 'confidence');
  const rr = numPayload(event, 'rr');
  if (confidence !== undefined && confidence < subs.minimumSignalConfidence) return 'CONFIDENCE';
  if (rr !== undefined && rr < subs.minimumRr) return 'RR';
  return undefined;
};

export const subscriptionReject = (
  event: AlertEvent,
  subs: AlertSubscriptions
): AlertSuppressReason | undefined => {
  if (classDisabled(event, subs)) return 'CLASS';
  if (symbolDisabled(event, subs)) return 'SYMBOL';
  if (belowSeverity(event, subs)) return 'SEVERITY';
  if (approachingBlocked(event, subs)) return 'LEVEL_APPROACHING';
  if (developingBlocked(event, subs)) return 'CLASS';
  if (sweepBlocked(event, subs)) return 'CLASS';
  return signalGate(event, subs);
};

export interface EngineOptions {
  readonly subscriptions?: AlertSubscriptions;
  readonly cooldownMs?: Partial<Record<AlertClass, number>>;
  readonly now?: () => number;
}

interface FingerprintMemory {
  readonly stateTo?: string;
  readonly at: number;
}

const DEFAULT_COOLDOWN: Readonly<Record<AlertClass, number>> = {
  SYSTEM: 15_000,
  MACRO: 60_000,
  MARKET: 300_000,
  LEVEL: 600_000,
  SETUP: 300_000,
  SIGNAL: 0,
  TRADE: 0,
  RESEARCH: 72_000_000,
};

export class NotificationEngine {
  private readonly subs: AlertSubscriptions;
  private readonly cooldown: Readonly<Record<AlertClass, number>>;
  private readonly now: () => number;
  private readonly memory = new Map<string, FingerprintMemory>();

  constructor(subs?: AlertSubscriptions, opts: EngineOptions = {}) {
    this.subs = subs ?? opts.subscriptions ?? defaultSubscriptions();
    this.cooldown = { ...DEFAULT_COOLDOWN, ...opts.cooldownMs };
    this.now = opts.now ?? Date.now;
  }

  submit(event: AlertEvent): AlertDecision {
    const blocked = subscriptionReject(event, this.subs);
    if (blocked) return { action: 'suppressed', reason: blocked, event };
    const dup = this.transitionReject(event);
    if (dup) return { action: 'suppressed', reason: dup, event };
    this.memory.set(event.fingerprint, { stateTo: event.stateTo, at: event.at || this.now() });
    return { action: 'emitted', event };
  }

  private transitionReject(event: AlertEvent): AlertSuppressReason | undefined {
    const prev = this.memory.get(event.fingerprint);
    if (!prev) return undefined;
    if (prev.stateTo !== event.stateTo) return undefined;
    const wait = this.cooldown[event.class];
    if (event.class === 'RESEARCH' && event.at - prev.at >= wait) return undefined;
    return 'DEDUPE';
  }
}
