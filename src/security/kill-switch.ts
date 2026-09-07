import type { EventStore } from '../infrastructure/events/event-store.js';

/**
 * Global trading kill switch.
 *
 * Two states only: NORMAL and HALTED. HALTED is a hard, durable gate —
 * while engaged, the pipeline refuses to run and the execution engine
 * refuses to submit, regardless of who asks or why. It survives restarts
 * (persisted through the event store) so a crash can never silently
 * re-arm trading after an operator pulled the plug.
 *
 * Fail-safe semantics: an unknown/unreadable state hydrates as HALTED.
 */
export type KillSwitchState = 'NORMAL' | 'HALTED';

interface KillSwitchEventPayload {
  readonly state: KillSwitchState;
  readonly reason: string;
  readonly actor: string;
}

export class KillSwitch {
  private currentState: KillSwitchState = 'HALTED';
  private reason = 'boot: default-halted until first event or explicit resume';
  private actor = 'system';
  private changedAt = Date.now();
  private readonly store?: EventStore;

  constructor(store?: EventStore) {
    this.store = store;
  }

  /** Rebuild from the event log; unknown state stays HALTED (fail-safe). */
  hydrate(events?: readonly { at: number; type: string; payload: unknown }[]): void {
    const source = events ?? this.store?.readAll(2000) ?? [];
    for (const e of source) {
      if (e.type !== 'killswitch.set') continue;
      const p = e.payload as Partial<KillSwitchEventPayload>;
      if (p?.state === 'NORMAL' || p?.state === 'HALTED') {
        this.currentState = p.state;
        this.reason = p.reason ?? 'unspecified';
        this.actor = p.actor ?? 'unknown';
        this.changedAt = e.at;
      }
    }
  }

  get state(): KillSwitchState {
    return this.currentState;
  }

  get halted(): boolean {
    return this.currentState === 'HALTED';
  }

  get currentReason(): string {
    return this.reason;
  }

  get lastChangedAt(): number {
    return this.changedAt;
  }

  get lastActor(): string {
    return this.actor;
  }

  /** Hard-stop trading. Idempotent; always records who and why. */
  halt(reason: string, actor: string, opts: { persist?: boolean } = {}): void {
    this.apply('HALTED', reason, actor, opts);
  }

  /** Resume trading. Requires an explicit non-empty reason. */
  resume(reason: string, actor: string, opts: { persist?: boolean } = {}): void {
    if (!reason || reason.trim().length === 0) {
      throw new Error('resume requires a non-empty reason (audit)');
    }
    this.apply('NORMAL', reason, actor, opts);
  }

  private apply(
    state: KillSwitchState,
    reason: string,
    actor: string,
    opts: { persist?: boolean }
  ): void {
    const changed = this.currentState !== state || this.reason !== reason;
    this.currentState = state;
    this.reason = reason;
    this.actor = actor;
    this.changedAt = Date.now();
    if (changed && opts.persist !== false && this.store) {
      this.store.appendClassified({
        type: 'killswitch.set',
        payload: { state, reason, actor } satisfies KillSwitchEventPayload,
      });
    }
  }
}
