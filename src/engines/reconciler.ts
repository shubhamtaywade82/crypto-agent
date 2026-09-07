import type {
  BrokerLookupResult, BrokerOrder, BrokerPosition, IExecutionBroker,
} from '../infrastructure/broker/broker.js';
import type { ExecutionEngine, TrackedOrder } from './execution-engine.js';
import { canTransition } from '../domain/orders/order-state.js';
import type { EventStore } from '../infrastructure/events/event-store.js';
import type { Logger } from '../infrastructure/observability/logger.js';
import { createLogger } from '../infrastructure/observability/logger.js';

export interface ReconcileReport {
  readonly checked: number;
  readonly resolved: number;
  readonly repaired: number;
  readonly stillUnknown: number;
  /** Lookups that failed (venue unreachable) — never treated as missing. */
  readonly lookupFailed: number;
  readonly details: readonly string[];
}

const RECONCILE_INTERVAL_MS = Number(process.env.RECONCILE_INTERVAL_MS ?? 15_000);

interface ReconcileCtx {
  readonly hasPositionFor: (pair: string) => boolean;
  readonly positionsAvailable: boolean;
  readonly details: string[];
  readonly counters: { resolved: number; repaired: number; stillUnknown: number; lookupFailed: number };
}

/**
 * Periodic truth-sync between internal order state and the broker.
 *
 * The reconciler is the ONLY component allowed to move an order out of
 * UNKNOWN, and it acts exclusively on CONFIRMED broker truth:
 *
 *   FOUND        -> fold the venue view into the FSM
 *   NOT_FOUND    -> apply the missing-order policy (venue answered: the
 *                   order does not exist; safe to mark CANCELLED when no
 *                   position evidence contradicts it)
 *   LOOKUP_FAILED-> do NOTHING destructive: an API outage, auth error or
 *                   rate limit must never be interpreted as "order gone".
 *                   The order keeps its state (UNKNOWN stays UNKNOWN).
 *
 * Orders and positions are reconciled together: an order the venue
 * reports FILLED is checked against live positions before being lifted
 * to POSITION_OPEN.
 */
export class Reconciler {
  private readonly broker: IExecutionBroker;
  private readonly execution: ExecutionEngine;
  private readonly store: EventStore;
  private readonly log: Logger;
  private timer?: NodeJS.Timeout;

  constructor(
    broker: IExecutionBroker,
    execution: ExecutionEngine,
    store: EventStore,
    log?: Logger
  ) {
    this.broker = broker;
    this.execution = execution;
    this.store = store;
    this.log = log ?? createLogger('reconciler');
  }

  start(intervalMs = RECONCILE_INTERVAL_MS): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      void this.reconcile().catch((err: unknown) => {
        this.log.error('reconcile failed', { err: err instanceof Error ? err.message : String(err) });
      });
    }, intervalMs);
    if (this.timer.unref) this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  async reconcile(): Promise<ReconcileReport> {
    const open = this.execution.listOpen();
    const details: string[] = [];
    const counters = { resolved: 0, repaired: 0, stillUnknown: 0, lookupFailed: 0 };

    // One positions snapshot per cycle: the second truth dimension.
    let positions: readonly BrokerPosition[] = [];
    let positionsAvailable = false;
    try {
      positions = await this.broker.getPositions();
      positionsAvailable = true;
    } catch (err) {
      this.log.warn('position snapshot failed; position evidence unavailable this cycle', {
        err: err instanceof Error ? err.message : String(err),
      });
    }

    const hasPositionFor = (pair: string): boolean =>
      positions.some((p) => p.pair === pair);

    for (const tracked of open) {
      try {
        await this.reconcileOne(tracked, { hasPositionFor, positionsAvailable, details, counters });
      } catch (err) {
        details.push(
          `${tracked.intentId}: reconcile error held state (${err instanceof Error ? err.message : String(err)})`
        );
      }
    }

    const report: ReconcileReport = {
      checked: open.length, resolved: counters.resolved, repaired: counters.repaired,
      stillUnknown: counters.stillUnknown, lookupFailed: counters.lookupFailed, details,
    };
    if (report.resolved + report.repaired > 0) {
      this.store.appendClassified({ type: 'reconcile', payload: report });
    }
    return report;
  }

  private async reconcileOne(tracked: TrackedOrder, ctx: ReconcileCtx): Promise<void> {
    const result = await this.lookup(tracked);
    if (result.kind === 'LOOKUP_FAILED') {
      this.onLookupFailed(tracked, ctx, result.reason);
      return;
    }
    if (result.kind === 'NOT_FOUND') {
      await this.onNotFound(tracked, ctx);
      return;
    }
    await this.onFound(tracked, ctx, result.order);
  }

  /** Outage/auth/rate-limit: never destructive — hold state. */
  private onLookupFailed(
    tracked: TrackedOrder,
    ctx: ReconcileCtx,
    reason: string
  ): void {
    ctx.counters.lookupFailed++;
    if (tracked.status === 'UNKNOWN') ctx.counters.stillUnknown++;
    ctx.details.push(
      `${tracked.intentId}: lookup failed (${reason}) -> state held at ${tracked.status}`
    );
  }

  /** Venue affirmatively answered: no such order. Missing-order policy. */
  private async onNotFound(tracked: TrackedOrder, ctx: ReconcileCtx): Promise<void> {
    // Never cancel when live position evidence contradicts it (a fill
    // may have escaped the order history page).
    if (ctx.positionsAvailable && ctx.hasPositionFor(tracked.pair)) {
      if (tracked.status === 'UNKNOWN') ctx.counters.stillUnknown++;
      ctx.details.push(
        `${tracked.intentId}: not in order history but position exists for ${tracked.pair}; held for manual review`
      );
      return;
    }
    if (tracked.status === 'SUBMITTING') {
      ctx.details.push(`${tracked.intentId}: SUBMITTING, skipped this cycle`);
      return;
    }
    if (canTransition(tracked.status, 'CANCELLED')) {
      this.execution.transition(tracked, 'CANCELLED');
      ctx.counters.repaired++;
      ctx.details.push(`${tracked.intentId}: confirmed missing broker-side -> CANCELLED`);
    }
  }

  /** Venue truth wins: fold the broker view, then reconcile the position. */
  private async onFound(
    tracked: TrackedOrder,
    ctx: ReconcileCtx,
    remote: BrokerOrder
  ): Promise<void> {
    if (tracked.status !== remote.status || tracked.filledQuantity !== remote.filledQuantity) {
      ctx.details.push(`${tracked.intentId}: ${tracked.status} -> ${remote.status}`);
      this.execution.applyBrokerUpdate(tracked, remote);
      ctx.counters.resolved++;
    }
    // A confirmed fill with a live position behind it advances to POSITION_OPEN.
    if (remote.status === 'FILLED' && ctx.positionsAvailable &&
      ctx.hasPositionFor(tracked.pair) && canTransition(tracked.status, 'POSITION_OPEN')) {
      this.execution.transition(tracked, 'POSITION_OPEN');
      ctx.counters.resolved++;
      ctx.details.push(`${tracked.intentId}: FILLED with live position -> POSITION_OPEN`);
    }
  }

  private async lookup(tracked: TrackedOrder): Promise<BrokerLookupResult> {
    try {
      return await this.broker.lookupOrder(tracked.pair, tracked.intentId);
    } catch (err) {
      // lookupOrder should classify internally; a thrown error is still
      // a FAILED lookup, never a missing order.
      const reason = err instanceof Error ? err.message : String(err);
      this.log.warn('remote order lookup threw', { intentId: tracked.intentId, err: reason });
      return { kind: 'LOOKUP_FAILED', reason };
    }
  }
}
