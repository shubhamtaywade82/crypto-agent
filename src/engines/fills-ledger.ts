import type { EventStore } from '../infrastructure/events/event-store.js';
import type { TrackedOrder } from './execution-engine.js';

/**
 * Live fills ledger with POSITION-LEVEL accounting (V3.1 P0-2).
 *
 * Every fold of broker truth that increases filled quantity is persisted
 * as a `fill.recorded` event and folded into:
 *   - execution-quality metrics (slippage vs the decision's expected
 *     price, fill latency),
 *   - a position ledger keyed by positionId -> lots -> fills -> decisionId
 *     (scale-ins append lots; exits close lots FIFO; flips net the
 *     opposite side first),
 *   - `position.opened` / `position.closed` audit events, with `close`
 *     fan-out to performance + learning attributed per LOT allocation.
 *
 * Exactly-once close semantics: `hydrate()` replays fills WITHOUT firing
 * the close fan-out or re-persisting position events (a restart must
 * never double-count realized PnL). The single authoritative
 * `trade.closed` journal event is persisted by the TradeLedger.
 */
export interface FillRecord {
  readonly at: number;
  readonly decisionId: string;
  readonly symbol: string;
  readonly pair: string;
  readonly side: 'buy' | 'sell';
  readonly price: number;
  /** Quantity ADDED by this fold (deltas keep replay deterministic). */
  readonly quantity: number;
  readonly cumulativeQuantity: number;
  readonly intentType: 'ENTRY' | 'EXIT' | 'REDUCE';
  readonly strategyId?: string;
  readonly expectedPrice?: number;
  readonly latencyMs: number;
}

export interface ExecutionQuality {
  readonly fills: number;
  /** Signed so worse-than-intended is positive (per side). */
  readonly avgSlippageBps: number;
  readonly worstSlippageBps: number;
  readonly avgFillLatencyMs: number;
  /** Lot-level realized allocations (FIFO) attributed to entry decisions. */
  readonly realizedTrades: number;
  readonly realizedPnl: number;
  /** Positions opened/closed so far; open = live right now. */
  readonly positionsOpened: number;
  readonly positionsClosed: number;
  readonly openPositions: number;
}

/** One opening fill within a position (FIFO close unit). */
export interface PositionLot {
  readonly decisionId: string;
  readonly strategyId?: string;
  readonly quantity: number;
  readonly price: number;
  readonly openedAt: number;
}

export interface PositionState {
  readonly positionId: string;
  readonly symbol: string;
  readonly side: 'buy' | 'sell';
  readonly lots: PositionLot[];
  readonly openedAt: number;
  realizedPnl: number;
  closedAt?: number;
}

/** PnL allocation of one EXIT/REDUCE fill against one entry lot. */
export interface PositionCloseAllocation {
  readonly positionId: string;
  readonly symbol: string;
  readonly side: 'buy' | 'sell';
  /** The ENTRY decision credited with this allocation. */
  readonly decisionId: string;
  readonly strategyId?: string;
  readonly pnl: number;
  readonly quantity: number;
  readonly at: number;
}

const EPS = 1e-9;

const dirOf = (side: 'buy' | 'sell'): 1 | -1 => (side === 'buy' ? 1 : -1);

/**
 * FIFO allocation of `qty` against a position's lots (pure except for the
 * lot bookkeeping on the position): consumes lots oldest-first, realizes
 * one allocation per lot, and removes exhausted lots. pnl = (exit −
 * entry) × direction × qty — direction handles shorts.
 */
const allocateFifo = (
  position: PositionState, f: FillRecord, qty: number
): PositionCloseAllocation[] => {
  const allocations: PositionCloseAllocation[] = [];
  let remaining = qty;
  const dir = dirOf(position.side);
  while (remaining > EPS && position.lots.length > 0) {
    const lot = position.lots[0];
    const closeQty = Math.min(lot.quantity, remaining);
    const pnl = (f.price - lot.price) * dir * closeQty;
    position.lots[0] = { ...lot, quantity: lot.quantity - closeQty };
    if (position.lots[0].quantity <= EPS) position.lots.shift();
    allocations.push({
      positionId: position.positionId, symbol: position.symbol, side: position.side,
      decisionId: lot.decisionId, strategyId: lot.strategyId,
      pnl, quantity: closeQty, at: f.at,
    });
    remaining -= closeQty;
  }
  return allocations;
};

/** Slippage in bps, signed so WORSE than intended is positive. */
export const slippageBps = (
  side: 'buy' | 'sell', price: number, expected: number
): number => ((price - expected) / expected) * 10_000 * dirOf(side);

export class FillsLedger {
  private readonly store: EventStore;
  private readonly venue: 'paper' | 'coindcx';
  private readonly fills: FillRecord[] = [];
  /** positionId -> live position (removed when fully closed). */
  private readonly positions = new Map<string, PositionState>();
  /** symbol -> positionId of the CURRENT open netting position. */
  private readonly openBySymbol = new Map<string, string>();
  private realizedPnlTotal = 0;
  private realizedCount = 0;
  private positionsOpened = 0;
  private positionsClosed = 0;
  /** decisionId -> cumulative filled quantity already folded. */
  private readonly lastCumulative = new Map<string, number>();
  private readonly onClose:
    | ((allocation: PositionCloseAllocation) => void)
    | undefined;
  /** True while replaying the event log: no fan-out, no persistence. */
  private replaying = false;

  constructor(
    store: EventStore,
    venue: 'paper' | 'coindcx',
    onClose?: (allocation: PositionCloseAllocation) => void
  ) {
    this.store = store;
    this.venue = venue;
    this.onClose = onClose;
  }

  /** Replay `fill.recorded` events to rebuild metrics + positions. */
  hydrate(): void {
    this.replaying = true;
    try {
      for (const event of this.store.readAll(Number.MAX_SAFE_INTEGER)) {
        if (event.type === 'fill.recorded') {
          this.fold(event.payload as Partial<FillRecord>);
        }
      }
    } finally {
      this.replaying = false;
    }
  }

  /**
   * Record the new fill quantity of a tracked order. The engine only calls
   * this on a quantity increase; the persisted event stores the DELTA plus
   * the cumulative quantity so replay attributes exactly once per unit.
   */
  record(tracked: TrackedOrder, at: number): FillRecord {
    const cumulative = tracked.filledQuantity;
    const delta = cumulative - (this.lastCumulative.get(tracked.intentId) ?? 0);
    if (delta <= 0 || tracked.avgFillPrice === undefined) {
      throw new Error(`fills.record called without a new fill (intent ${tracked.intentId})`);
    }
    const record: FillRecord = {
      at,
      decisionId: tracked.intentId,
      symbol: tracked.symbol,
      pair: tracked.pair,
      side: tracked.side,
      price: tracked.avgFillPrice,
      quantity: delta,
      cumulativeQuantity: cumulative,
      intentType: tracked.intentType,
      strategyId: tracked.strategyId,
      expectedPrice: tracked.expectedPrice,
      latencyMs: Math.max(0, at - tracked.registeredAt),
    };
    this.store.appendClassified({
      type: 'fill.recorded', symbol: record.symbol, decisionId: record.decisionId,
      payload: record as unknown as Record<string, unknown>,
    });
    this.fold(record as unknown as Partial<FillRecord>);
    return record;
  }

  get all(): readonly FillRecord[] {
    return this.fills;
  }

  /** Live position views (open only; closed positions are history). */
  openPositions(): readonly PositionState[] {
    return [...this.positions.values()];
  }

  position(positionId: string): PositionState | undefined {
    return this.positions.get(positionId);
  }

  quality(): ExecutionQuality {
    const withSlippage = this.fills.filter(
      (f) => f.expectedPrice !== undefined && f.expectedPrice > 0 && f.quantity > 0
    );
    const slippages = withSlippage.map((f) => slippageBps(f.side, f.price, f.expectedPrice!));
    const avg = (xs: number[]): number =>
      xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length;
    return {
      fills: this.fills.length,
      avgSlippageBps: Number(avg(slippages).toFixed(2)),
      worstSlippageBps: slippages.length === 0 ? 0 : Number(Math.max(...slippages).toFixed(2)),
      avgFillLatencyMs: Math.round(avg(this.fills.map((f) => f.latencyMs))),
      realizedTrades: this.realizedCount,
      realizedPnl: Number(this.realizedPnlTotal.toFixed(4)),
      positionsOpened: this.positionsOpened,
      positionsClosed: this.positionsClosed,
      openPositions: this.positions.size,
    };
  }

  /** Fold one fill into position accounting; persists nothing (events are the truth). */
  private fold(p: Partial<FillRecord>): void {
    if (p.price === undefined || p.quantity === undefined || !p.symbol || !p.side) return;
    this.fills.push(p as FillRecord);
    if (p.decisionId && p.cumulativeQuantity !== undefined) {
      this.lastCumulative.set(p.decisionId, Math.max(
        this.lastCumulative.get(p.decisionId) ?? 0, p.cumulativeQuantity
      ));
    }
    this.attribute(p as FillRecord);
  }

  /** Persist a position lifecycle event (live folds only, never replay). */
  private persist(type: 'position.opened' | 'position.closed', payload: Record<string, unknown>): void {
    if (this.replaying) return;
    this.store.appendClassified({
      type,
      symbol: typeof payload.symbol === 'string' ? payload.symbol : undefined,
      payload,
    });
  }

  /**
   * Position accounting on the NETTING model (one open position per
   * symbol): ENTRY builds lots on the current position (opposite side
   * first nets it down, remainder flips), EXIT/REDUCE closes lots FIFO.
   */
  private attribute(f: FillRecord): void {
    const openId = this.openBySymbol.get(f.symbol);
    const open = openId ? this.positions.get(openId) : undefined;
    if (f.intentType === 'ENTRY') {
      this.attributeEntry(f, open);
      return;
    }
    if (open) this.closeFifo(open, f, f.quantity);
  }

  /** ENTRY fill: extend, flip, or open the symbol's netting position. */
  private attributeEntry(f: FillRecord, open: PositionState | undefined): void {
    if (!open) {
      this.openPosition(f);
      return;
    }
    if (open.side === f.side) {
      // Scale-in: append a lot carrying its own decision lineage.
      open.lots.push({
        decisionId: f.decisionId, strategyId: f.strategyId,
        quantity: f.quantity, price: f.price, openedAt: f.at,
      });
      return;
    }
    // Opposite side: net down the existing position first...
    const closed = this.closeFifo(open, f, f.quantity);
    const remainder = f.quantity - closed;
    if (remainder > EPS) {
      // ...then flip: the leftover opens a fresh position on this side.
      this.openPosition({ ...f, quantity: remainder });
    }
  }

  private openPosition(f: FillRecord): void {
    const positionId = `pos:${f.symbol}:${f.side}:${f.decisionId}`;
    const position: PositionState = {
      positionId, symbol: f.symbol, side: f.side,
      lots: [{
        decisionId: f.decisionId, strategyId: f.strategyId,
        quantity: f.quantity, price: f.price, openedAt: f.at,
      }],
      openedAt: f.at, realizedPnl: 0,
    };
    this.positions.set(positionId, position);
    this.openBySymbol.set(f.symbol, positionId);
    this.positionsOpened += 1;
    this.persist('position.opened', {
      positionId, symbol: f.symbol, side: f.side,
      decisionId: f.decisionId, quantity: f.quantity, price: f.price, at: f.at,
    });
  }

  /**
   * FIFO-close up to `qty` against the position's lots. Returns the
   * closed quantity; fires the close fan-out ONCE per lot allocation
   * when the position fully closes (live path only).
   */
  private closeFifo(position: PositionState, f: FillRecord, qty: number): number {
    let remaining = Math.min(qty, this.netQuantity(position));
    const allocations = allocateFifo(position, f, remaining);
    remaining -= allocations.reduce((a, x) => a + x.quantity, 0);
    for (const a of allocations) {
      position.realizedPnl += a.pnl;
      this.realizedPnlTotal += a.pnl;
      this.realizedCount += 1;
    }
    if (position.lots.length === 0 && allocations.length > 0) {
      position.closedAt = f.at;
      this.positions.delete(position.positionId);
      this.openBySymbol.delete(position.symbol);
      this.positionsClosed += 1;
      this.persist('position.closed', {
        positionId: position.positionId, symbol: position.symbol, side: position.side,
        realizedPnl: Number(position.realizedPnl.toFixed(10)),
        openedAt: position.openedAt, closedAt: position.closedAt,
        allocations: allocations.map((a) => ({
          decisionId: a.decisionId, pnl: Number(a.pnl.toFixed(10)), quantity: a.quantity,
        })),
      });
    }
    // Live venue only: the paper simulator already emits realized closes
    // through its own onClose ledger (double counting would corrupt risk).
    if (this.venue === 'coindcx' && !this.replaying) {
      for (const a of allocations) this.onClose?.(a);
    }
    return allocations.reduce((a, x) => a + x.quantity, 0);
  }

  private netQuantity(position: PositionState): number {
    return position.lots.reduce((a, lot) => a + lot.quantity, 0);
  }
}
