import type { MarketState } from '../../domain/market/types.js';
import type { SetupCandidate } from '../setup-engine.js';
import type { MiFreshEvent } from '../mi-event-scan.js';
import type { SetupPhase } from '../../domain/alerts/types.js';
import { makeAlert } from './make-alert.js';
import type { AlertDispatcher } from './dispatcher.js';
import { distancePct } from './level-tracker.js';

const NOTIFY_PHASES: ReadonlySet<SetupPhase> = new Set([
  'WATCHING', 'ZONE_REACHED', 'CONFIRMING', 'CONFIRMED', 'INVALIDATED', 'EXPIRED',
]);

const zoneKey = (c: SetupCandidate): string =>
  `${c.symbol}:${c.type}:${c.direction}:${c.entry.toFixed(1)}`;

const inZone = (price: number, entry: number): boolean => distancePct(price, entry) <= 0.12;

const approaching = (price: number, entry: number): boolean => distancePct(price, entry) <= 0.35;

const breached = (c: SetupCandidate, close: number): boolean =>
  c.direction === 'LONG' ? close < c.stopLoss : close > c.stopLoss;

export const inferPhase = (args: {
  readonly candidate: SetupCandidate | undefined;
  readonly price: number;
  readonly close5m: number;
  readonly mi: readonly MiFreshEvent[];
  readonly prev: SetupPhase;
}): SetupPhase => {
  const { candidate, price, close5m, mi, prev } = args;
  if (!candidate) return prev === 'NONE' ? 'NONE' : 'EXPIRED';
  if (breached(candidate, close5m)) return 'INVALIDATED';
  const trigger = mi.some((e) => e.eventType === 'choch' || e.eventType === 'liquidity_sweep');
  if (inZone(price, candidate.entry) && trigger) {
    if (candidate.confidence >= 0.75) return 'CONFIRMED';
    if (prev === 'TRIGGER_DETECTED' || prev === 'CONFIRMING') return 'CONFIRMING';
    return 'TRIGGER_DETECTED';
  }
  if (inZone(price, candidate.entry)) return 'ZONE_REACHED';
  if (approaching(price, candidate.entry)) return 'APPROACHING';
  return 'WATCHING';
};

interface SetupMem {
  phase: SetupPhase;
  candidate?: SetupCandidate;
}

export class SetupTracker {
  private readonly mem = new Map<string, SetupMem>();

  constructor(private readonly dispatcher: AlertDispatcher) {}

  snapshot(key: string): SetupMem | undefined {
    return this.mem.get(key);
  }

  async observe(
    state: MarketState,
    setups: readonly SetupCandidate[],
    mi: readonly MiFreshEvent[],
    openSymbols: ReadonlySet<string> = new Set()
  ): Promise<SetupCandidate | undefined> {
    const price = state.price.last;
    const close5m = state.timeframes['5m'].lastClose;
    const seen = new Set<string>();
    let confirmed: SetupCandidate | undefined;
    for (const c of setups) {
      const key = zoneKey(c);
      seen.add(key);
      const prev = this.mem.get(key)?.phase ?? 'NONE';
      const phase = inferPhase({ candidate: c, price, close5m, mi, prev });
      this.mem.set(key, { phase, candidate: c });
      if (phase !== prev && NOTIFY_PHASES.has(phase)) {
        await this.emit({ state, c, from: prev, to: phase, positionOpen: openSymbols.has(c.symbol) });
      }
      if (phase === 'CONFIRMED') confirmed = c;
    }
    await this.expireMissing(state, seen, close5m, openSymbols);
    return confirmed;
  }

  private async expireMissing(
    state: MarketState,
    seen: ReadonlySet<string>,
    close5m: number,
    openSymbols: ReadonlySet<string>
  ): Promise<void> {
    for (const [key, mem] of this.mem) {
      if (seen.has(key) || !mem.candidate || mem.phase === 'EXPIRED' || mem.phase === 'INVALIDATED') continue;
      const next: SetupPhase = breached(mem.candidate, close5m) ? 'INVALIDATED' : 'EXPIRED';
      const prev = mem.phase;
      mem.phase = next;
      await this.emit({ state, c: mem.candidate, from: prev, to: next, positionOpen: openSymbols.has(mem.candidate.symbol) });
    }
  }

  private async emit(p: {
    readonly state: MarketState;
    readonly c: SetupCandidate;
    readonly from: SetupPhase;
    readonly to: SetupPhase;
    readonly positionOpen: boolean;
  }): Promise<void> {
    const { state, c, from, to, positionOpen } = p;
    await this.dispatcher.publish(makeAlert({
      at: state.capturedAt,
      class: to === 'INVALIDATED' ? 'SIGNAL' : 'SETUP',
      severity: to === 'WATCHING' ? 'WATCH' : 'IMPORTANT',
      symbol: c.symbol,
      title: titleFor(to, c),
      body: bodyFor(state, c, to),
      fingerprint: `SETUP:${zoneKey(c)}`,
      stateFrom: from,
      stateTo: to,
      payload: {
        setupType: c.type, direction: c.direction, confidence: c.confidence, rr: c.rr,
        entry: c.entry, stopLoss: c.stopLoss, takeProfit: c.takeProfit, invalidation: c.invalidation,
      },
    }));
    if (to === 'INVALIDATED' && positionOpen) await this.emitExitRequired(state, c);
  }

  private async emitExitRequired(state: MarketState, c: SetupCandidate): Promise<void> {
    await this.dispatcher.publish(makeAlert({
      at: state.capturedAt,
      class: 'TRADE',
      severity: 'CRITICAL',
      symbol: c.symbol,
      title: 'POSITION ALERT',
      body: `${c.symbol} ${c.direction}\nInvalidation breached.\nPosition: OPEN\nRisk engine: EXIT REQUIRED`,
      fingerprint: `TRADE:${c.symbol}:exit-required`,
      stateTo: 'EXIT_REQUIRED',
      payload: { setupType: c.type },
    }));
  }
}

const titleFor = (phase: SetupPhase, c: SetupCandidate): string => {
  if (phase === 'WATCHING' || phase === 'APPROACHING') return 'SETUP DEVELOPING';
  if (phase === 'ZONE_REACHED') return 'SETUP ZONE REACHED';
  if (phase === 'CONFIRMING') return 'SETUP CONFIRMING';
  if (phase === 'CONFIRMED') return `SETUP CONFIRMED — ${c.direction}`;
  if (phase === 'INVALIDATED') return 'SIGNAL INVALIDATED';
  return 'SETUP EXPIRED';
};

const bodyFor = (state: MarketState, c: SetupCandidate, phase: SetupPhase): string =>
  [
    `${c.symbol} ${c.direction} ${c.type}`,
    `Location: ${c.entry.toFixed(2)}  SL ${c.stopLoss.toFixed(2)}  TP ${c.takeProfit.toFixed(2)}`,
    `Current: ${state.price.last.toFixed(2)}  RR ${c.rr.toFixed(1)}  conf ${(c.confidence * 100).toFixed(0)}%`,
    `Status: ${phase}`,
    phase === 'INVALIDATED' ? `Reason: 5M vs invalidation ${c.invalidation}` : '',
  ].filter(Boolean).join('\n');
