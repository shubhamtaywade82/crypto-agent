import type { EventStore } from '../infrastructure/events/event-store.js';
import type { TrackedOrder } from './execution-engine.js';

/**
 * Live fills ledger: every fold of broker truth that increases filled
 * quantity is persisted as a `fill.recorded` event and folded into
 * execution-quality metrics (slippage vs the decision's expected price,
 * fill latency) and — for the LIVE venue — position-level realized PnL
 * attributed back to the OPEN decision's feature snapshot.
 *
 * Deterministic: the same event replay always produces the same position
 * accounting, so restarts never double-count or lose fills.
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
  readonly realizedTrades: number;
  readonly realizedPnl: number;
}

/** Directional exposure bucket for realized-PnL attribution. */
interface OpenLot {
  quantity: number;
  notional: number;
  decisionId: string;
}

const dirOf = (side: 'buy' | 'sell'): 1 | -1 => (side === 'buy' ? 1 : -1);

/** Slippage in bps, signed so WORSE than intended is positive. */
export const slippageBps = (
  side: 'buy' | 'sell', price: number, expected: number
): number => ((price - expected) / expected) * 10_000 * dirOf(side);

export class FillsLedger {
  private readonly store: EventStore;
  private readonly venue: 'paper' | 'coindcx';
  private readonly fills: FillRecord[] = [];
  /** symbol -> exposure lots (entry side implied by lot sign via side field). */
  private readonly lots = new Map<string, OpenLot & { readonly side: 'buy' | 'sell' }>();
  private realizedPnlTotal = 0;
  private realizedCount = 0;
  /** decisionId -> cumulative filled quantity already folded. */
  private readonly lastCumulative = new Map<string, number>();
  private readonly onClose: ((decisionId: string, pnl: number, at: number) => void) | undefined;

  constructor(
    store: EventStore,
    venue: 'paper' | 'coindcx',
    onClose?: (decisionId: string, pnl: number, at: number) => void
  ) {
    this.store = store;
    this.venue = venue;
    this.onClose = onClose;
  }

  /** Replay `fill.recorded` events to rebuild metrics + position lots. */
  hydrate(): void {
    for (const event of this.store.readAll(Number.MAX_SAFE_INTEGER)) {
      if (event.type === 'fill.recorded') this.fold(event.payload as Partial<FillRecord>);
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

  /**
   * Position accounting: ENTRY fills build the average open price; EXIT/REDUCE
   * fills realize PnL against it and attribute the close to the ENTRY
   * decision (the feature snapshot the outcome belongs to).
   */
  private attribute(f: FillRecord): void {
    const lot = this.lots.get(f.symbol);
    const isEntry = f.intentType === 'ENTRY';
    if (isEntry) {
      const merged = lot && lot.side === f.side
        ? {
            side: lot.side,
            quantity: lot.quantity + f.quantity,
            notional: lot.notional + f.price * f.quantity,
            decisionId: lot.decisionId,
          }
        : { side: f.side, quantity: f.quantity, notional: f.price * f.quantity, decisionId: f.decisionId };
      this.lots.set(f.symbol, merged);
      return;
    }
    if (!lot || lot.quantity <= 0) return; // nothing to attribute against
    const dir = dirOf(lot.side);
    const closeQty = Math.min(lot.quantity, f.quantity);
    const avgOpen = lot.notional / lot.quantity;
    // pnl = (exit - entry) * direction * qty — direction handles shorts.
    const pnl = (f.price - avgOpen) * dir * closeQty;
    lot.quantity -= closeQty;
    lot.notional = lot.quantity > 0 ? avgOpen * lot.quantity : 0;
    const attributedTo = lot.decisionId;
    if (lot.quantity <= 0) this.lots.delete(f.symbol);
    this.realizedPnlTotal += pnl;
    this.realizedCount += 1;
    // Live venue only: the paper simulator already emits realized closes
    // through its own onClose ledger (double counting would corrupt risk).
    if (this.venue === 'coindcx') this.onClose?.(attributedTo, pnl, f.at);
  }
}
