/**
 * Live account cache fed by the CoinDCX private WS stream, with REST
 * snapshots as the seeding/recovery path. Shapes are deliberately neutral
 * (no SDK types) so engine code stays venue-agnostic; the account-stream
 * adapter translates SDK events into these updates.
 */
export interface PositionUpdate {
  readonly pair: string;
  readonly side: 'long' | 'short';
  readonly size: number;
  readonly entryPrice: number;
  readonly markPrice?: number;
  readonly unrealizedPnl?: number;
  readonly at: number;
}

export interface BalanceUpdate {
  readonly currency: string;
  readonly total: number;
  readonly locked?: number;
  readonly at: number;
}

export interface OrderUpdate {
  readonly id: string;
  readonly clientOrderId?: string;
  readonly pair?: string;
  readonly status: string;
  readonly filledQuantity?: number;
  readonly at: number;
}

export interface CachedPosition {
  readonly pair: string;
  readonly side: 'long' | 'short';
  readonly size: number;
  readonly entryPrice: number;
  readonly markPrice?: number;
  readonly unrealizedPnl?: number;
}

export interface CachedBalance {
  readonly currency: string;
  readonly total: number;
}

/** Broker-compatible projection (feeds PortfolioEngine without REST). */
export interface AccountSnapshot {
  readonly positions: readonly (BrokerPositionLike & { at: number })[];
  readonly balances: readonly CachedBalance[];
  readonly updatedAt?: number;
}

export interface BrokerPositionLike {
  readonly pair: string;
  readonly side: 'long' | 'short';
  readonly size: number;
  readonly entryPrice: number;
  readonly leverage?: number;
  readonly unrealizedPnl?: number;
}

/**
 * Keyed by pair (positions) and currency (balances); WS updates mutate the
 * same keys the REST snapshot seeds, so interleaving both paths converges.
 */
export class PortfolioStateStore {
  private readonly positions = new Map<string, CachedPosition & { at: number }>();
  private readonly balances = new Map<string, CachedBalance & { at: number }>();
  private readonly orderStatus = new Map<string, OrderUpdate>();
  private lastEventAt?: number;

  applyPosition(u: PositionUpdate): void {
    const key = `${u.pair}#${u.side}`;
    if (u.size === 0) this.positions.delete(key);
    else {
      this.positions.set(key, {
        pair: u.pair, side: u.side, size: u.size, entryPrice: u.entryPrice,
        markPrice: u.markPrice, unrealizedPnl: u.unrealizedPnl, at: u.at,
      });
    }
    this.touch(u.at);
  }

  applyBalance(u: BalanceUpdate): void {
    if (u.total === 0 && (u.locked === undefined || u.locked === 0)) {
      this.balances.delete(u.currency.toUpperCase());
    } else {
      this.balances.set(u.currency.toUpperCase(), {
        currency: u.currency.toUpperCase(), total: u.total, at: u.at,
      });
    }
    this.touch(u.at);
  }

  applyOrder(u: OrderUpdate): void {
    this.orderStatus.set(u.id, u);
    this.touch(u.at);
  }

  /** REST full snapshot: the recovery path that (re)seeds the cache. */
  syncSnapshot(positions: readonly BrokerPositionLike[], balances: readonly CachedBalance[], at: number): void {
    this.positions.clear();
    for (const p of positions) {
      this.positions.set(`${p.pair}#${p.side}`, { ...p, at });
    }
    this.balances.clear();
    for (const b of balances) {
      this.balances.set(b.currency.toUpperCase(), { ...b, at });
    }
    this.touch(at);
  }

  lastOrder(id: string): OrderUpdate | undefined {
    return this.orderStatus.get(id);
  }

  positionsNow(): readonly (CachedPosition & { at: number })[] {
    return [...this.positions.values()];
  }

  balancesNow(): readonly CachedBalance[] {
    return [...this.balances.values()];
  }

  stalenessMs(now: number = Date.now()): number | undefined {
    return this.lastEventAt === undefined ? undefined : Math.max(0, now - this.lastEventAt);
  }

  isFresh(maxAgeMs: number, now: number = Date.now()): boolean {
    const age = this.stalenessMs(now);
    return age !== undefined && age <= maxAgeMs;
  }

  private touch(at: number): void {
    this.lastEventAt = Math.max(this.lastEventAt ?? 0, at);
  }
}
