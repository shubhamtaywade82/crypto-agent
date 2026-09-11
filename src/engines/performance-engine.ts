import type { PortfolioMetricsSource } from './portfolio-engine.js';
import type { EventStore } from '../infrastructure/events/event-store.js';

export interface PerformanceStats {
  readonly realizedPnl: number;
  readonly unrealizedPnl: number;
  readonly tradeCount: number;
  readonly winCount: number;
  readonly lossCount: number;
  readonly winRate: number;
  readonly averageWin: number;
  readonly averageLoss: number;
  readonly profitFactor: number;
  readonly expectancy: number;
  readonly lossStreak: number;
  readonly winStreak: number;
  readonly maxDrawdownPercent: number;
  readonly equityHighWaterMark: number;
}

const utcDay = (at: number): number => Math.floor(at / 86_400_000);

/**
 * Deterministic performance ledger for the trading kernel.
 *
 * Replaces the previous `() => 0` placeholder metrics source: daily
 * realized PnL, loss streak and drawdown are now measured from actual
 * trading outcomes and equity snapshots, and persisted through the
 * event store so a restart does not amnesia-reset the risk governor.
 *
 * This is the data bridge between trading and learning: outcomes land
 * here first, statistically-validated promotion comes later.
 */
const EQUITY_PERSIST_INTERVAL_MS = 60_000;
const EQUITY_PERSIST_MIN_DELTA = 1;
const EQUITY_PERSIST_MIN_PCT = 0.05;

export class PerformanceEngine {
  private readonly store?: EventStore;
  private lastPersistedEquity?: number;
  private lastPersistedAt = 0;

  /** UTC-day bucketed realized PnL: day -> pnl. */
  private readonly dailyPnl = new Map<number, number>();
  /** Closing trades: { pnl, at } in chronological order. */
  private readonly closes: { pnl: number; at: number }[] = [];

  private equityHwm = 0;
  private drawdownPercent = 0;
  private lossStreak = 0;
  private winStreak = 0;
  private maxDrawdownPercent = 0;

  constructor(store?: EventStore) {
    this.store = store;
  }

  /** Rebuild state from the event log (call once at startup). */
  hydrate(events?: readonly { at: number; type: string; payload: unknown }[]): void {
    const source = events ?? this.store?.readAll(2000) ?? [];
    for (const e of source) {
      if (e.type === 'trade.closed') {
        const p = e.payload as { pnl?: number };
        if (typeof p?.pnl === 'number') this.recordTradeClosed(p.pnl, e.at, { persist: false });
      } else if (e.type === 'portfolio.equity') {
        const p = e.payload as { equity?: number };
        if (typeof p?.equity === 'number') this.recordEquity(p.equity, e.at, { persist: false });
      }
    }
  }

  /**
   * Feed the current equity. Tracks the high-water mark and the
   * peak-to-valley drawdown that gates the EMERGENCY circuit state.
   */
  private shouldPersistEquity(equity: number, at: number): boolean {
    if (this.lastPersistedEquity === undefined) return true;
    const elapsed = at - this.lastPersistedAt;
    const delta = Math.abs(equity - this.lastPersistedEquity);
    const pct = this.lastPersistedEquity > 0 ? (delta / this.lastPersistedEquity) * 100 : Infinity;
    return elapsed >= EQUITY_PERSIST_INTERVAL_MS || delta >= EQUITY_PERSIST_MIN_DELTA || pct >= EQUITY_PERSIST_MIN_PCT;
  }

  recordEquity(equity: number, at = Date.now(), opts: { persist?: boolean } = {}): void {
    if (equity > this.equityHwm || this.equityHwm === 0) {
      this.equityHwm = equity;
    }
    this.drawdownPercent = this.equityHwm > 0
      ? ((this.equityHwm - equity) / this.equityHwm) * 100
      : 0;
    this.drawdownPercent = Math.max(0, this.drawdownPercent);
    this.maxDrawdownPercent = Math.max(this.maxDrawdownPercent, this.drawdownPercent);
    if (opts.persist !== false && this.store && Number.isFinite(equity) && this.shouldPersistEquity(equity, at)) {
      this.store.append({ type: 'portfolio.equity', payload: { equity, drawdownPercent: this.drawdownPercent } });
      this.lastPersistedEquity = equity;
      this.lastPersistedAt = at;
    }
  }

  /** Record one realized position close (pnl in canonical USDT). */
  recordTradeClosed(pnl: number, at = Date.now(), opts: { persist?: boolean } = {}): void {
    this.closes.push({ pnl, at });
    const day = utcDay(at);
    this.dailyPnl.set(day, (this.dailyPnl.get(day) ?? 0) + pnl);
    if (pnl < 0) {
      this.lossStreak += 1;
      this.winStreak = 0;
    } else if (pnl > 0) {
      this.winStreak += 1;
      this.lossStreak = 0;
    }
    if (opts.persist !== false && this.store && Number.isFinite(pnl)) {
      this.store.append({ type: 'trade.closed', payload: { pnl, lossStreak: this.lossStreak } });
    }
  }

  getDailyRealizedPnl(): number {
    return this.dailyPnl.get(utcDay(Date.now())) ?? 0;
  }

  getLossStreak(): number {
    return this.lossStreak;
  }

  getDrawdownPercent(): number {
    return this.drawdownPercent;
  }

  /** PortfolioMetricsSource adapter — wire this into PortfolioEngine. */
  metricsSource(): PortfolioMetricsSource {
    return {
      getDailyRealizedPnl: () => this.getDailyRealizedPnl(),
      getLossStreak: () => this.getLossStreak(),
      getDrawdownPercent: () => this.getDrawdownPercent(),
    };
  }

  /** Full statistics snapshot for dashboards and the learning layer. */
  stats(): PerformanceStats {
    const wins = this.closes.filter((c) => c.pnl > 0);
    const losses = this.closes.filter((c) => c.pnl < 0);
    const grossWin = wins.reduce((a, c) => a + c.pnl, 0);
    const grossLoss = Math.abs(losses.reduce((a, c) => a + c.pnl, 0));
    const n = this.closes.length;
    return {
      realizedPnl: this.closes.reduce((a, c) => a + c.pnl, 0),
      unrealizedPnl: 0,
      tradeCount: n,
      winCount: wins.length,
      lossCount: losses.length,
      winRate: n > 0 ? wins.length / n : 0,
      averageWin: wins.length > 0 ? grossWin / wins.length : 0,
      averageLoss: losses.length > 0 ? grossLoss / losses.length : 0,
      profitFactor: grossLoss > 0 ? grossWin / grossLoss : grossWin > 0 ? Number.POSITIVE_INFINITY : 0,
      expectancy: n > 0 ? this.closes.reduce((a, c) => a + c.pnl, 0) / n : 0,
      lossStreak: this.lossStreak,
      winStreak: this.winStreak,
      maxDrawdownPercent: this.maxDrawdownPercent,
      equityHighWaterMark: this.equityHwm,
    };
  }
}
