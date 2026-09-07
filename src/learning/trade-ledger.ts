import type { EventStore } from '../infrastructure/events/event-store.js';

/**
 * Trade ledger — the bridge between trading and learning (ROADMAP Phase 5).
 *
 * Every executed trade is recorded as a FEATURE SNAPSHOT (`trade.opened`)
 * keyed by decisionId: setup type, regime, direction, planned R:R, funding
 * at entry, sizing facts and strategist confidence. When the position
 * realizes, the Outcome lands (`trade.closed` with the same decisionId)
 * and the ledger derives R multiples, holding time and MAE/MFE.
 *
 * Replaying the event log reconstructs the full outcome dataset — the raw
 * material for per-cell statistics and statistically-gated strategy
 * promotion.
 */

export interface TradeFeatureSnapshot {
  readonly decisionId: string;
  readonly symbol: string;
  /** Strategy/setup identity for attribution. */
  readonly strategyId: string;
  readonly direction: 'LONG' | 'SHORT';
  readonly entry: number;
  readonly stopLoss: number;
  readonly takeProfit: number;
  /** Planned reward/risk at entry (engine-validated). */
  readonly plannedRr: number;
  readonly regime: string;
  readonly fundingRate: number;
  readonly leverage: number;
  /** Canonical USDT risk the kernel authorized. */
  readonly riskAmount: number;
  readonly notional: number;
  /** Strategist confidence at decision time (0..1). */
  readonly confidence: number;
  readonly openedAt: number;
}

export interface TradeOutcomeRecord extends TradeFeatureSnapshot {
  readonly pnl: number;
  /** Realized outcome in R units: pnl / riskAmount. */
  readonly rMultiple: number;
  readonly holdingMinutes: number;
  /** Max adverse excursion in R (0 when unobserved). */
  readonly maxAdverseR: number;
  /** Max favorable excursion in R (0 when unobserved). */
  readonly maxFavorableR: number;
  readonly closedAt: number;
}

interface OpenTrade {
  readonly snapshot: TradeFeatureSnapshot;
  /** Running extreme prices since entry (for MAE/MFE in R). */
  worstPrice: number;
  bestPrice: number;
}

export const cellOf = (t: { strategyId: string; regime: string }): string =>
  `${t.strategyId}|${t.regime}`;

/**
 * MAE/MFE in R from observed price extremes since entry. Sign-aware:
 * for a LONG the adverse extreme is the lowest print, for a SHORT the
 * highest. Capped by the planned geometry so data glitches cannot
 * fabricate absurd excursions.
 */
const excursionsInR = (
  s: TradeFeatureSnapshot,
  worstPrice: number,
  bestPrice: number
): { adverse: number; favorable: number } => {
  const riskPerUnit = Math.abs(s.entry - s.stopLoss);
  if (riskPerUnit <= 0) return { adverse: 0, favorable: 0 };
  const long = s.direction !== 'SHORT';
  const adverseMove = long ? s.entry - worstPrice : worstPrice - s.entry;
  const favorableMove = long ? bestPrice - s.entry : s.entry - bestPrice;
  const adverse = Math.max(0, adverseMove) / riskPerUnit;
  const favorable = Math.max(0, favorableMove) / riskPerUnit;
  return { adverse: Math.min(adverse, Math.abs(s.plannedRr + 1)), favorable };
};

export class TradeLedger {
  private readonly open = new Map<string, OpenTrade>();
  private readonly closed: TradeOutcomeRecord[] = [];
  private readonly store?: EventStore;

  constructor(store?: EventStore) {
    this.store = store;
  }

  /** Rebuild from the event log (call once at startup, before use). */
  hydrate(events?: readonly { at: number; type: string; decisionId?: string; payload: unknown }[]): void {
    const source = events ?? this.store?.readAll(5000) ?? [];
    for (const e of source) {
      if (e.type === 'trade.opened') {
        this.ingestOpened(e.payload as TradeFeatureSnapshot, false);
      } else if (e.type === 'trade.closed') {
        const payload = { ...(e.payload as Record<string, unknown>), at: e.at };
        this.ingestClosed({ decisionId: e.decisionId, payload }, false);
      }
    }
  }

  /** Record an executed entry (called by the pipeline after EXECUTED). */
  recordOpened(snapshot: TradeFeatureSnapshot, opts: { persist?: boolean } = {}): void {
    this.ingestOpened(snapshot, opts.persist !== false);
  }

  private ingestOpened(payload: TradeFeatureSnapshot, persist: boolean): void {
    if (!payload || typeof payload.decisionId !== 'string' ||
      typeof payload.entry !== 'number' || typeof payload.stopLoss !== 'number') return;
    const long = payload.direction !== 'SHORT';
    this.open.set(payload.decisionId, {
      snapshot: payload,
      worstPrice: long ? payload.entry : payload.entry,
      bestPrice: payload.entry,
    });
    if (persist && this.store) {
      this.store.append({ type: 'trade.opened', decisionId: payload.decisionId, symbol: payload.symbol, payload });
    }
  }

  /**
   * Feed the current mark price for a symbol: updates MAE/MFE extremes
   * for every open trade on that symbol. Cheap enough to call per tick.
   */
  recordMark(symbol: string, price: number): void {
    if (!Number.isFinite(price)) return;
    for (const trade of this.open.values()) {
      if (trade.snapshot.symbol !== symbol) continue;
      const long = trade.snapshot.direction !== 'SHORT';
      trade.worstPrice = long
        ? Math.min(trade.worstPrice, price)
        : Math.max(trade.worstPrice, price);
      trade.bestPrice = long
        ? Math.max(trade.bestPrice, price)
        : Math.min(trade.bestPrice, price);
    }
  }

  /** Record a realized close by decisionId (paper venue or fills ledger). */
  recordClosed(
    decisionId: string,
    pnl: number,
    closedAt = Date.now(),
    opts: { persist?: boolean } = {}
  ): TradeOutcomeRecord | undefined {
    return this.ingestClosed({ decisionId, payload: { pnl, at: closedAt } }, opts.persist !== false);
  }

  /** Fold a `trade.closed` event; unknown decisionIds are ignored (orphans). */
  private ingestClosed(
    e: { decisionId?: string; payload: Record<string, unknown> },
    persist: boolean
  ): TradeOutcomeRecord | undefined {
    const id = e.decisionId ?? (typeof e.payload?.decisionId === 'string' ? e.payload.decisionId : undefined);
    if (!id) return undefined;
    const trade = this.open.get(id);
    if (!trade) return undefined;
    const pnl = e.payload?.pnl;
    if (typeof pnl !== 'number' || !Number.isFinite(pnl)) return undefined;

    const s = trade.snapshot;
    const closedAt = typeof e.payload?.at === 'number' ? e.payload.at : Date.now();
    const { adverse, favorable } = excursionsInR(s, trade.worstPrice, trade.bestPrice);
    const record: TradeOutcomeRecord = {
      ...s,
      pnl,
      rMultiple: s.riskAmount > 0 ? pnl / s.riskAmount : 0,
      holdingMinutes: Math.max(0, (closedAt - s.openedAt) / 60_000),
      maxAdverseR: adverse,
      maxFavorableR: favorable,
      closedAt,
    };
    this.open.delete(id);
    this.closed.push(record);
    if (persist && this.store) {
      this.store.append({
        type: 'trade.closed', decisionId: id, symbol: s.symbol,
        payload: { pnl, rMultiple: record.rMultiple, strategyId: s.strategyId, regime: s.regime },
      });
    }
    return record;
  }

  get openTrades(): readonly TradeFeatureSnapshot[] {
    return [...this.open.values()].map((t) => t.snapshot);
  }

  get outcomes(): readonly TradeOutcomeRecord[] {
    return this.closed;
  }

  /** All outcomes within one setup×regime cell. */
  outcomesForCell(cell: string): readonly TradeOutcomeRecord[] {
    return this.closed.filter((t) => cellOf(t) === cell);
  }
}
