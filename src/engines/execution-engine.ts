import type { IExecutionBroker, PlaceOrderRequest } from '../infrastructure/broker/broker.js';
import type { OrderStatus } from '../domain/orders/order-state.js';
import { assertTransition } from '../domain/orders/order-state.js';
import type { BrokerOrder } from '../infrastructure/broker/broker.js';
import type { EventStore } from '../infrastructure/events/event-store.js';
import type { Logger } from '../infrastructure/observability/logger.js';
import { createLogger } from '../infrastructure/observability/logger.js';

export interface TrackedOrder {
  readonly intentId: string;
  readonly pair: string;
  readonly symbol: string;
  readonly side: 'buy' | 'sell';
  readonly quantity: number;
  readonly reduceOnly: boolean;
  status: OrderStatus;
  orderId?: string;
  filledQuantity: number;
  avgFillPrice?: number;
  updatedAt: number;
}

const SUBMIT_TIMEOUT_MS = 10_000;

/**
 * Order lifecycle runtime. Owns the FSM transitions and the critical
 * UNKNOWN path: if submission times out, the order goes UNKNOWN and only
 * the Reconciler may resolve it (never the agent).
 */
export class ExecutionEngine {
  private readonly broker: IExecutionBroker;
  private readonly store: EventStore;
  private readonly log: Logger;
  private readonly orders = new Map<string, TrackedOrder>();
  /** Optional global gate (kill switch). Returns block reason or null. */
  private submissionGate: (() => string | null) | undefined;

  constructor(broker: IExecutionBroker, store: EventStore, log?: Logger) {
    this.broker = broker;
    this.store = store;
    this.log = log ?? createLogger('execution');
  }

  /**
   * Install a global submission gate (defense in depth against the
   * durable kill switch). While it returns a reason, no new order is
   * submitted through this engine.
   */
  setSubmissionGate(gate: () => string | null): void {
    this.submissionGate = gate;
  }

  get(intentId: string): TrackedOrder | undefined {
    return this.orders.get(intentId);
  }

  /** Open orders still needing reconciliation — UNKNOWN included by design. */
  listOpen(): readonly TrackedOrder[] {
    return [...this.orders.values()].filter(
      (o) => o.status !== 'CLOSED' && o.status !== 'REJECTED' &&
        o.status !== 'CANCELLED' && o.status !== 'EXPIRED'
    );
  }

  /** Mark intent as risk-approved and eligible for submission. */
  registerApproved(spec: {
    readonly intentId: string;
    readonly pair: string;
    readonly symbol: string;
    readonly side: 'buy' | 'sell';
    readonly quantity: number;
  }): TrackedOrder {
    const tracked: TrackedOrder = {
      intentId: spec.intentId, pair: spec.pair, symbol: spec.symbol,
      side: spec.side, quantity: spec.quantity, reduceOnly: false,
      status: 'RISK_APPROVED', filledQuantity: 0, updatedAt: Date.now(),
    };
    this.orders.set(spec.intentId, tracked);
    this.store.appendClassified({
      type: 'order.registered', symbol: spec.symbol, decisionId: spec.intentId,
      payload: { pair: spec.pair, side: spec.side, quantity: spec.quantity },
    });
    return tracked;
  }

  /** Submit through the broker; resolves UNKNOWN on timeout. */
  async submit(intentId: string, req: Omit<PlaceOrderRequest, 'intentId'>): Promise<TrackedOrder> {
    const tracked = this.orders.get(intentId);
    if (!tracked) throw new Error(`unknown intent ${intentId}`);
    // Durability contract: never send an order to the venue while the
    // audit backbone cannot persist its lifecycle.
    if (!this.store.healthy) {
      throw new Error(`event store unhealthy (last: ${this.store.lastError}); submission blocked`);
    }
    // Global gate: the durable kill switch wins over every other path.
    const blocked = this.submissionGate?.();
    if (blocked) {
      this.store.appendClassified({
        type: 'order.blocked', symbol: tracked.symbol, decisionId: intentId,
        payload: { reason: blocked },
      });
      throw new Error(`submission blocked: ${blocked}`);
    }
    this.transition(tracked, 'SUBMITTING');
    try {
      const placed = await withTimeout(
        this.broker.placeOrder({ ...req, intentId }),
        SUBMIT_TIMEOUT_MS
      );
      this.applyBrokerUpdate(tracked, placed);
      return tracked;
    } catch (err) {
      this.transition(tracked, 'UNKNOWN');
      this.store.appendClassified({
        type: 'order.unknown', symbol: tracked.symbol, decisionId: intentId,
        payload: { reason: err instanceof Error ? err.message : String(err) },
      });
      this.log.warn('submission unresolved -> UNKNOWN', { intentId });
      return tracked;
    }
  }

  /** Fold a broker-side order view into the tracked FSM state. */
  applyBrokerUpdate(tracked: TrackedOrder, update: BrokerOrder): void {
    tracked.orderId = update.orderId;
    tracked.filledQuantity = update.filledQuantity;
    if (update.avgFillPrice !== undefined) tracked.avgFillPrice = update.avgFillPrice;
    this.transition(tracked, update.status);
    tracked.updatedAt = Date.now();
  }

  /** Cancel an eligible order. */
  async cancel(intentId: string): Promise<void> {
    const tracked = this.orders.get(intentId);
    if (!tracked || !tracked.orderId) throw new Error(`order ${intentId} not cancellable`);
    await this.broker.cancelOrder(tracked.pair, tracked.orderId);
    this.transition(tracked, 'CANCELLED');
  }

  transition(tracked: TrackedOrder, to: OrderStatus): void {
    if (tracked.status === to) return;
    // Capture the OLD state BEFORE mutating — the audit event must record
    // the actual transition (from -> to), not from<new> -> to<new>.
    const from: OrderStatus = tracked.status;
    assertTransition(from, to);
    tracked.status = to;
    tracked.updatedAt = Date.now();
    this.store.appendClassified({
      type: 'order.transition', symbol: tracked.symbol, decisionId: tracked.intentId,
      payload: { from, to, orderId: tracked.orderId ?? null },
    });
  }
}

const withTimeout = async <T>(p: Promise<T>, ms: number): Promise<T> => {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      p,
      new Promise<never>((_, rej) => {
        timer = setTimeout(() => rej(new Error(`timeout after ${ms}ms`)), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
};
