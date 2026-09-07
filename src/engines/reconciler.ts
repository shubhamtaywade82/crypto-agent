import type { BrokerOrder, IExecutionBroker } from '../infrastructure/broker/broker.js';
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
  readonly details: readonly string[];
}

const RECONCILE_INTERVAL_MS = Number(process.env.RECONCILE_INTERVAL_MS ?? 15_000);

/**
 * Periodic truth-sync between internal order state and the broker.
 * The reconciler is the ONLY component allowed to move an order out of
 * UNKNOWN: query-by-client_order_id first, then open-orders sweep.
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
    let resolved = 0;
    let repaired = 0;
    let stillUnknown = 0;

    for (const tracked of open) {
      const remote = await this.findRemote(tracked);
      if (!remote) {
        if (tracked.status === 'UNKNOWN') {
          stillUnknown++;
          details.push(`${tracked.intentId}: still unknown`);
          continue;
        }
        // Internal open order vanished broker-side without a cancel.
        if (canTransition(tracked.status, 'CANCELLED') && tracked.status !== 'SUBMITTING') {
          this.execution.transition(tracked, 'CANCELLED');
          repaired++;
          details.push(`${tracked.intentId}: missing broker-side -> CANCELLED`);
        }
        continue;
      }
      if (tracked.status !== remote.status || tracked.filledQuantity !== remote.filledQuantity) {
        details.push(`${tracked.intentId}: ${tracked.status} -> ${remote.status}`);
        this.execution.applyBrokerUpdate(tracked, remote);
        resolved++;
      }
    }

    const report: ReconcileReport = {
      checked: open.length, resolved, repaired, stillUnknown, details,
    };
    if (resolved + repaired > 0) {
      this.store.append({ type: 'reconcile', payload: report });
    }
    return report;
  }

  private async findRemote(tracked: TrackedOrder): Promise<BrokerOrder | undefined> {
    try {
      return await this.broker.getOrder(tracked.pair, tracked.intentId);
    } catch (err) {
      this.log.warn('remote order lookup failed', {
        intentId: tracked.intentId,
        err: err instanceof Error ? err.message : String(err),
      });
      return undefined;
    }
  }
}
