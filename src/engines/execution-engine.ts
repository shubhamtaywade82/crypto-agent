import type { IExecutionBroker, PlaceOrderRequest, BrokerOrder } from '../infrastructure/broker/broker.js';
import type { OrderStatus } from '../domain/orders/order-state.js';
import { assertTransition } from '../domain/orders/order-state.js';
import { breachesBand, marginalFillPrice, type SlippageBreach } from '../domain/orders/slippage.js';
import type { EventStore } from '../infrastructure/events/event-store.js';
import { createLogger, type Logger } from '../infrastructure/observability/logger.js';

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
  registeredAt: number;
  expectedPrice?: number;
  maxSlippageBps?: number;
  slippageBreach?: SlippageBreach;
  intentType: 'ENTRY' | 'EXIT' | 'REDUCE';
  strategyId?: string;
  readonly reservationId?: string;
}

const SUBMIT_TIMEOUT_MS = 10_000;
/** Terminal states never revived on restart; in-flight states revive to UNKNOWN for reconciler truth. */
const TERMINAL: ReadonlySet<OrderStatus> = new Set(['CLOSED', 'REJECTED', 'CANCELLED', 'EXPIRED']);

interface HydratedOrder {
  readonly intentId: string; readonly symbol: string; readonly pair: string;
  readonly side: 'buy' | 'sell'; readonly quantity: number; readonly status: OrderStatus;
  readonly orderId?: string; readonly registeredAt: number; readonly reservationId?: string;
}

/** Scan the event log into per-decision register + last-transition views. */
type RawOrderEvent = { at: number; type: string; decisionId?: string; symbol?: string; payload: unknown };
interface EventIndexes {
  readonly registered: Map<string, { symbol: string; at: number; payload: Record<string, unknown> }>;
  readonly transitions: Map<string, { to: OrderStatus; orderId: string | null }[]>;
  readonly submitted: Set<string>;
}

const indexEvents = (source: readonly RawOrderEvent[]): EventIndexes => {
  const registered = new Map<string, { symbol: string; at: number; payload: Record<string, unknown> }>();
  const transitions = new Map<string, { to: OrderStatus; orderId: string | null }[]>();
  const submitted = new Set<string>();
  for (const e of source) {
    if (!e.decisionId) continue;
    if (e.type === 'order.registered') {
      registered.set(e.decisionId, { symbol: e.symbol ?? '', at: e.at, payload: e.payload as Record<string, unknown> });
    } else if (e.type === 'order.submission_intent') {
      submitted.add(e.decisionId);
    } else if (e.type === 'order.transition') {
      const p = e.payload as { to?: OrderStatus; orderId?: string | null };
      if (p?.to) {
        const list = transitions.get(e.decisionId) ?? [];
        list.push({ to: p.to, orderId: p.orderId ?? null });
        transitions.set(e.decisionId, list);
      }
    }
  }
  return { registered, transitions, submitted };
};

/** Scan event log into per-decision register + last-transition views. */
const scanOrderEvents = (source: readonly RawOrderEvent[]): Map<string, HydratedOrder> => {
  const { registered, transitions, submitted } = indexEvents(source);
  const out = new Map<string, HydratedOrder>();
  for (const [id, reg] of registered) {
    const last = transitions.get(id)?.at(-1);
    let status: OrderStatus = last ? last.to : 'RISK_APPROVED';
    // Revive in-flight or submitted crashes as UNKNOWN so Reconciler queries truth.
    if (status === 'SUBMITTING' || (status === 'RISK_APPROVED' && submitted.has(id))) status = 'UNKNOWN';
    if (TERMINAL.has(status)) continue;
    out.set(id, {
      intentId: id, symbol: reg.symbol, pair: String(reg.payload?.pair ?? ''),
      side: reg.payload?.side === 'sell' ? 'sell' : 'buy', quantity: Number(reg.payload?.quantity ?? 0),
      registeredAt: reg.at, status, orderId: last?.orderId ?? undefined,
      reservationId: typeof reg.payload?.reservationId === 'string' ? reg.payload.reservationId : undefined,
    });
  }
  return out;
};

export class ExecutionEngine {
  private readonly orders = new Map<string, TrackedOrder>();
  private readonly cancelRequested = new Set<string>();
  private readonly log: Logger;
  private submissionGate?: () => string | null;
  private onFill?: (tracked: TrackedOrder, at: number) => void;

  constructor(
    private readonly broker: IExecutionBroker,
    private readonly store: EventStore,
    log?: Logger
  ) {
    this.log = log ?? createLogger('execution');
  }

  setSubmissionGate(gate: () => string | null): void {
    this.submissionGate = gate;
  }

  /** Install the fills observer (execution-quality + live PnL attribution). */
  setFillHook(hook: (tracked: TrackedOrder, at: number) => void): void {
    this.onFill = hook;
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
    readonly intentId: string; readonly pair: string; readonly symbol: string;
    readonly side: 'buy' | 'sell'; readonly quantity: number; readonly reservationId?: string;
  }): TrackedOrder {
    const tracked: TrackedOrder = {
      intentId: spec.intentId, pair: spec.pair, symbol: spec.symbol,
      side: spec.side, quantity: spec.quantity, reduceOnly: false,
      status: 'RISK_APPROVED', filledQuantity: 0, updatedAt: Date.now(),
      registeredAt: Date.now(), intentType: 'ENTRY', reservationId: spec.reservationId,
    };
    this.orders.set(spec.intentId, tracked);
    this.store.appendClassified({
      type: 'order.registered', symbol: spec.symbol, decisionId: spec.intentId,
      payload: { pair: spec.pair, side: spec.side, quantity: spec.quantity, reservationId: spec.reservationId },
    });
    return tracked;
  }

  /** Durability + gate + idempotency checks shared by the submit path. */
  private assertSubmittable(tracked: TrackedOrder): void {
    if (tracked.status !== 'RISK_APPROVED') {
      throw new Error(`intent ${tracked.intentId} not submittable in status ${tracked.status}`);
    }
    if (!this.store.healthy) {
      throw new Error(`event store unhealthy (last: ${this.store.lastError}); submission blocked`);
    }
    const blocked = this.submissionGate?.();
    if (blocked) {
      this.store.appendClassified({
        type: 'order.blocked', symbol: tracked.symbol, decisionId: tracked.intentId, payload: { reason: blocked },
      });
      throw new Error(`submission blocked: ${blocked}`);
    }
  }

  /** Submit through the broker; resolves UNKNOWN on timeout. */
  async submit(intentId: string, req: Omit<PlaceOrderRequest, 'intentId'>): Promise<TrackedOrder> {
    const tracked = this.orders.get(intentId);
    if (!tracked) throw new Error(`unknown intent ${intentId}`);
    this.assertSubmittable(tracked);
    if (req.maxSlippageBps !== undefined && req.expectedPrice === undefined) {
      throw new Error('maxSlippageBps requires expectedPrice (execution-quality contract)');
    }
    tracked.expectedPrice = req.expectedPrice;
    tracked.maxSlippageBps = req.maxSlippageBps;
    tracked.intentType = req.intentType ?? 'ENTRY';
    tracked.strategyId = req.strategyId;
    this.transition(tracked, 'SUBMITTING');
    this.store.appendClassified({
      type: 'order.submission_intent', symbol: tracked.symbol, decisionId: intentId,
      payload: { pair: req.pair, side: req.side, quantity: req.quantity, expectedPrice: req.expectedPrice },
    });
    try {
      const placed = await withTimeout(this.broker.placeOrder({ ...req, intentId }), SUBMIT_TIMEOUT_MS);
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
    const prevFilled = tracked.filledQuantity;
    const prevAvg = tracked.avgFillPrice;
    tracked.orderId = update.orderId;
    tracked.filledQuantity = update.filledQuantity;
    if (update.avgFillPrice !== undefined) tracked.avgFillPrice = update.avgFillPrice;
    this.transition(tracked, update.status);
    tracked.updatedAt = Date.now();
    // Fire the fills observer for every NEW fill quantity (submit path and
    // reconciler fold both go through here, so nothing can bypass it).
    if (tracked.filledQuantity > prevFilled && tracked.avgFillPrice !== undefined) {
      this.enforceSlippage(tracked, prevFilled, prevAvg);
      this.onFill?.(tracked, tracked.updatedAt);
    }
  }

  /**
   * Deterministic slippage enforcement (V3.1 P0-1): every fill delta is
   * checked against expectedPrice ± maxSlippageBps. A breach is persisted
   * as a CRITICAL audit event and the un-filled remainder is cancelled so
   * no further quantity executes beyond the tolerated band.
   */
  private enforceSlippage(
    tracked: TrackedOrder, prevFilled: number, prevAvg: number | undefined
  ): void {
    const limit = tracked.maxSlippageBps;
    if (limit === undefined || tracked.expectedPrice === undefined) return;
    const marginal = marginalFillPrice(prevFilled, prevAvg, tracked.filledQuantity, tracked.avgFillPrice!);
    if (!Number.isFinite(marginal) || marginal <= 0) return;
    const { breach, bps } = breachesBand(tracked.side, marginal, tracked.expectedPrice, limit);
    if (!breach) return;
    const breachEvent: SlippageBreach = {
      expectedPrice: tracked.expectedPrice, fillPrice: marginal, slippageBps: bps,
      limitBps: limit, at: Date.now(), filledQuantity: tracked.filledQuantity, orderedQuantity: tracked.quantity,
    };
    tracked.slippageBreach = breachEvent;
    this.store.appendClassified({
      type: 'execution.slippage_breach', symbol: tracked.symbol,
      decisionId: tracked.intentId, payload: breachEvent as unknown as Record<string, unknown>,
    });
    this.log.warn('slippage breach — enforcing tolerance band', {
      intentId: tracked.intentId, slippageBps: Number(bps.toFixed(2)), limitBps: limit,
    });
    this.cancelRemainder(tracked);
  }

  /** Best-effort cancel of the un-filled remainder after a breach. */
  private cancelRemainder(tracked: TrackedOrder): void {
    const cancellable =
      tracked.filledQuantity < tracked.quantity && tracked.orderId !== undefined &&
      (tracked.status === 'SUBMITTED' || tracked.status === 'ACKNOWLEDGED' || tracked.status === 'PARTIALLY_FILLED');
    if (!cancellable || this.cancelRequested.has(tracked.intentId)) return;
    this.cancelRequested.add(tracked.intentId);
    void this.cancel(tracked.intentId).catch((err: unknown): void => {
      this.log.warn('post-breach remainder cancel failed', { intentId: tracked.intentId, err: String(err) });
    });
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
    // Capture the OLD state BEFORE mutating — audit event records actual transition (from -> to)
    const from: OrderStatus = tracked.status;
    assertTransition(from, to);
    tracked.status = to;
    tracked.updatedAt = Date.now();
    this.store.appendClassified({
      type: 'order.transition', symbol: tracked.symbol, decisionId: tracked.intentId,
      payload: { from, to, orderId: tracked.orderId ?? null },
    });
  }

  /** Rebuild tracked orders from event log. Revives UNKNOWN for reconciler convergence. */
  hydrate(events?: readonly { at: number; type: string; decisionId?: string; symbol?: string; payload: unknown }[]): void {
    const source = events ?? this.store.readAll(5000);
    for (const h of scanOrderEvents(source).values()) {
      this.orders.set(h.intentId, {
        intentId: h.intentId, pair: h.pair, symbol: h.symbol, side: h.side, quantity: h.quantity,
        reduceOnly: false, status: h.status, orderId: h.orderId, filledQuantity: 0,
        updatedAt: Date.now(), registeredAt: h.registeredAt, intentType: 'ENTRY', reservationId: h.reservationId,
      });
    }
  }
}

const withTimeout = async <T>(p: Promise<T>, ms: number): Promise<T> => {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      p,
      new Promise<never>((_, rej) => { timer = setTimeout(() => rej(new Error(`timeout after ${ms}ms`)), ms); }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
};
