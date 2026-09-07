import type { PortfolioState } from '../domain/portfolio/portfolio-state.js';
import { clusterExposureOf, symbolExposureOf } from '../domain/portfolio/portfolio-state.js';
import type { RejectionReason } from '../domain/risk/risk-decision.js';
import type { RiskLimits } from '../domain/risk/risk-config.js';
import { makeId } from '../domain/primitives.js';
import type { EventStore } from '../infrastructure/events/event-store.js';

export interface RiskReservation {
  readonly id: string;
  readonly symbol: string;
  readonly cluster: string;
  readonly notional: number;
  readonly riskAmount: number;
  readonly addsPosition: boolean;
  readonly createdAt: number;
  readonly expiresAt: number;
  state: 'ACTIVE' | 'COMMITTED' | 'RELEASED' | 'EXPIRED';
}

export interface ReservationRequest {
  readonly symbol: string;
  readonly cluster: string;
  readonly notional: number;
  readonly riskAmount: number;
  readonly addsPosition: boolean;
  /** Hold lifetime (default 90s — enough to submit and reach a fill). */
  readonly ttlMs?: number;
}

export interface ReservationCheck {
  readonly ok: boolean;
  readonly rejections: readonly RejectionReason[];
  readonly detail: string;
  readonly reservation?: RiskReservation;
}

export const DEFAULT_RESERVATION_TTL_MS = 90_000;

interface Projection {
  readonly projectedPositions: number;
  readonly symbolNow: number;
  readonly clusterNow: number;
  readonly grossNow: number;
  readonly equity: number;
}

const sumNotional = (rs: readonly RiskReservation[]): number =>
  rs.reduce((acc, r) => acc + r.notional, 0);

/** Broker state + all active reservations + the candidate order. */
const project = (
  portfolio: PortfolioState,
  active: readonly RiskReservation[],
  req: ReservationRequest
): Projection => ({
  projectedPositions: portfolio.openPositions +
    active.filter((r) => r.addsPosition).length + (req.addsPosition ? 1 : 0),
  symbolNow: symbolExposureOf(portfolio, req.symbol) +
    sumNotional(active.filter((r) => r.symbol === req.symbol)) + req.notional,
  clusterNow: clusterExposureOf(portfolio, req.cluster) +
    sumNotional(active.filter((r) => r.cluster === req.cluster)) + req.notional,
  grossNow: portfolio.grossExposure + sumNotional(active) + req.notional,
  equity: Math.max(1, portfolio.equity),
});

const limitRejections = (
  p: Projection,
  req: ReservationRequest,
  limits: RiskLimits
): RejectionReason[] => {
  const pct = (v: number): number => (v / p.equity) * 100;
  const rejections: RejectionReason[] = [];
  if (req.addsPosition && p.projectedPositions > limits.maxConcurrentPositions) {
    rejections.push('MAX_POSITIONS_EXCEEDED');
  }
  if (pct(p.symbolNow) > limits.maxSymbolExposurePercent) {
    rejections.push('SYMBOL_EXPOSURE_EXCEEDED');
  }
  if (pct(p.grossNow) > limits.maxPortfolioGrossExposurePercent) {
    rejections.push('PORTFOLIO_EXPOSURE_EXCEEDED');
  }
  if (pct(p.clusterNow) > limits.maxCorrelatedExposurePercent) {
    rejections.push('CORRELATED_EXPOSURE_EXCEEDED');
  }
  if (req.notional > limits.maxNotionalPerTrade) {
    rejections.push('MAX_NOTIONAL_EXCEEDED');
  }
  return rejections;
};

/**
 * Global risk reservations — the missing half of concurrency control.
 *
 * Per-symbol lanes serialize work WITHIN one symbol, but risk is GLOBAL:
 * two concurrent lanes can both read `openPositions = 0` and both get
 * approved, breaching maxConcurrentPositions or the gross-exposure cap.
 *
 * The pipeline therefore places a reservation immediately after risk
 * approval; every subsequent lane evaluates risk against
 * `broker state + all active reservations`. Reservations are:
 *   COMMITTED  when the order fills (exposure is now broker-visible)
 *   RELEASED   on reject/cancel/expire/execution error
 *   EXPIRED    by TTL, covering orders stuck in UNKNOWN
 */
export class RiskReservationManager {
  private readonly reservations = new Map<string, RiskReservation>();
  private readonly store?: EventStore;

  constructor(store?: EventStore) {
    this.store = store;
  }

  /** Expired holds reaped since the last sweep (for observability). */
  sweepExpired(now = Date.now()): string[] {
    const expired: string[] = [];
    for (const r of this.reservations.values()) {
      if (r.state === 'ACTIVE' && r.expiresAt <= now) {
        r.state = 'EXPIRED';
        expired.push(r.id);
        this.store?.append({
          type: 'risk.reservation', payload: { id: r.id, event: 'EXPIRED', symbol: r.symbol },
        });
      }
    }
    return expired;
  }

  active(): readonly RiskReservation[] {
    return [...this.reservations.values()].filter((r) => r.state === 'ACTIVE');
  }

  get(id: string): RiskReservation | undefined {
    return this.reservations.get(id);
  }

  /** Notional currently held by active reservations. */
  activeNotional(symbol?: string, cluster?: string): number {
    return sumNotional(this.active().filter((r) =>
      (symbol === undefined || r.symbol === symbol) &&
      (cluster === undefined || r.cluster === cluster)));
  }

  /**
   * Check global limits against `broker state + active reservations`
   * and, if within envelope, place a hold.
   */
  reserve(
    portfolio: PortfolioState,
    req: ReservationRequest,
    limits: RiskLimits
  ): ReservationCheck {
    this.sweepExpired();
    const p = project(portfolio, this.active(), req);
    const rejections = limitRejections(p, req, limits);
    if (rejections.length > 0) return this.decline(rejections, p, limits);
    return this.place(req, p);
  }

  private decline(
    rejections: readonly RejectionReason[],
    p: Projection,
    limits: RiskLimits
  ): ReservationCheck {
    const pct = (v: number): number => (v / p.equity) * 100;
    return {
      ok: false,
      rejections,
      detail: `reservation declined: ${rejections.join(',')} | ` +
        `positions ${p.projectedPositions}/${limits.maxConcurrentPositions}, ` +
        `symbol ${pct(p.symbolNow).toFixed(2)}%/${limits.maxSymbolExposurePercent}%, ` +
        `cluster ${pct(p.clusterNow).toFixed(2)}%/${limits.maxCorrelatedExposurePercent}%, ` +
        `gross ${pct(p.grossNow).toFixed(2)}%/${limits.maxPortfolioGrossExposurePercent}%`,
    };
  }

  private place(req: ReservationRequest, p: Projection): ReservationCheck {
    const ttl = req.ttlMs ?? DEFAULT_RESERVATION_TTL_MS;
    const reservation: RiskReservation = {
      id: makeId('resv'),
      symbol: req.symbol,
      cluster: req.cluster,
      notional: req.notional,
      riskAmount: req.riskAmount,
      addsPosition: req.addsPosition,
      createdAt: Date.now(),
      expiresAt: Date.now() + ttl,
      state: 'ACTIVE',
    };
    this.reservations.set(reservation.id, reservation);
    this.store?.append({
      type: 'risk.reservation', symbol: req.symbol,
      payload: {
        id: reservation.id, event: 'ACTIVE', notional: reservation.notional,
        riskAmount: reservation.riskAmount, expiresAt: reservation.expiresAt,
      },
    });
    const pct = (v: number): number => (v / p.equity) * 100;
    return {
      ok: true, rejections: [], reservation,
      detail: `reserved ${req.notional.toFixed(2)} on ${req.symbol} ` +
        `(projected gross ${pct(p.grossNow).toFixed(2)}%, positions ${p.projectedPositions})`,
    };
  }

  /** Fill confirmed: exposure is now broker-visible; retire the hold. */
  commit(id: string): void {
    const r = this.reservations.get(id);
    if (r?.state === 'ACTIVE') {
      r.state = 'COMMITTED';
      this.store?.append({
        type: 'risk.reservation', symbol: r.symbol,
        payload: { id, event: 'COMMITTED', notional: r.notional },
      });
    }
  }

  /** Order failed / never reached the venue: free the risk budget. */
  release(id: string, reason = 'RELEASED'): void {
    const r = this.reservations.get(id);
    if (r?.state === 'ACTIVE') {
      r.state = 'RELEASED';
      this.store?.append({
        type: 'risk.reservation', symbol: r.symbol,
        payload: { id, event: reason, notional: r.notional },
      });
    }
  }
}
