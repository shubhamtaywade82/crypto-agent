/**
 * Canonical currency valuation for the trading kernel.
 *
 * The execution account is INR-aware (CoinDCX) while all kernel math
 * (risk, sizing, PnL) is USDT-denominated. Every INR balance must be
 * normalized through a live USDT/INR FX rate with an explicit freshness
 * contract:
 *
 *   FRESH    age <  freshMs   -> use freely
 *   STALE    freshMs..staleMs -> usable for accounting, refresh attempted
 *   INVALID  age >  staleMs   -> never used for execution pricing
 *
 * A rate cached without TTL can silently stay wrong forever; that is a
 * trading-accounting correctness hazard, not a refinement.
 */

export type FxFreshness = 'FRESH' | 'STALE' | 'REFRESHED' | 'UNAVAILABLE';

export interface FxRateOptions {
  /** Age below which the cached rate is considered fresh (default 30s). */
  readonly freshMs?: number;
  /** Max age at which a cached rate may still be used (default 120s). */
  readonly staleMs?: number;
}

interface FxEntry {
  readonly rate: number;
  readonly at: number;
}

export interface FxQuote {
  readonly rate: number;
  readonly freshness: Exclude<FxFreshness, 'UNAVAILABLE'>;
}

export const DEFAULT_FX_OPTIONS: Required<FxRateOptions> = {
  freshMs: 30_000,
  staleMs: 120_000,
};

/**
 * TTL-based FX cache with an explicit staleness policy.
 * - fresh hit: no network call
 * - stale hit: async refresh attempt; stale value used only if refresh
 *   fails AND the entry is still within the stale window
 * - expired: refresh attempt; on failure the quote is UNAVAILABLE and
 *   callers must degrade (never price execution with a dead rate)
 */
export class FxRateCache {
  private readonly opts: Required<FxRateOptions>;
  private entry?: FxEntry;
  private lastError?: string;

  constructor(opts: FxRateOptions = {}) {
    const merged = { ...DEFAULT_FX_OPTIONS, ...opts };
    if (merged.staleMs < merged.freshMs) {
      throw new Error('FxRateCache: staleMs must be >= freshMs');
    }
    this.opts = merged;
  }

  /** Current cached entry without refreshing (for diagnostics). */
  peek(): { rate: number; ageMs: number; freshness: FxFreshness } | undefined {
    if (!this.entry) return undefined;
    const ageMs = Date.now() - this.entry.at;
    return {
      rate: this.entry.rate,
      ageMs,
      freshness: ageMs < this.opts.freshMs ? 'FRESH'
        : ageMs < this.opts.staleMs ? 'STALE' : 'UNAVAILABLE',
    };
  }

  lastErrorMessage(): string | undefined {
    return this.lastError;
  }

  async quote(fetcher: () => Promise<number>): Promise<FxQuote> {
    const age = this.entry ? Date.now() - this.entry.at : Number.POSITIVE_INFINITY;
    if (age < this.opts.freshMs) {
      return { rate: this.entry!.rate, freshness: 'FRESH' };
    }
    try {
      const rate = await fetcher();
      if (!Number.isFinite(rate) || rate <= 0) {
        throw new Error(`non-positive FX rate ${rate}`);
      }
      this.entry = { rate, at: Date.now() };
      this.lastError = undefined;
      return { rate, freshness: 'REFRESHED' };
    } catch (err) {
      this.lastError = err instanceof Error ? err.message : String(err);
      if (age < this.opts.staleMs) {
        return { rate: this.entry!.rate, freshness: 'STALE' };
      }
      throw new Error(
        `FX rate unavailable and cache expired (> ${this.opts.staleMs}ms): ${this.lastError}`
      );
    }
  }

  /** Synchronous valuation when a quote is already held; NaN otherwise. */
  cachedRate(): number {
    const age = this.entry ? Date.now() - this.entry.at : Number.POSITIVE_INFINITY;
    return age < this.opts.staleMs ? this.entry!.rate : Number.NaN;
  }
}

export interface BalanceLike {
  readonly currency: string;
  readonly total: number;
}

export interface ValuationResult {
  /** Wallet equity normalized into the canonical basis (USDT). */
  readonly equity: number;
  /** FX rate applied to INR balances (1 when no INR balances present). */
  readonly fxRate: number;
  readonly fxFreshness: FxFreshness | 'NOT_REQUIRED';
  /** Currencies excluded from valuation (cannot be normalized safely). */
  readonly excluded: readonly string[];
}

export const USDT_BASIS = 'USDT' as const;

/**
 * Sum balances into canonical USDT equity.
 * - USDT counts 1:1
 * - INR divides by the live USDT/INR rate
 * - anything else is EXCLUDED (never silently added — 10,000 INR +
 *   1,000 USDT must never become 11,000)
 */
export const normalizeBalances = (
  balances: readonly BalanceLike[],
  fxRate: number,
  fxFreshness: FxFreshness | 'NOT_REQUIRED'
): ValuationResult => {
  let equity = 0;
  const excluded: string[] = [];
  let needsFx = false;

  for (const b of balances) {
    const ccy = b.currency.toUpperCase();
    if (ccy === USDT_BASIS) {
      equity += b.total;
    } else if (ccy === 'INR') {
      needsFx = true;
      equity += b.total / fxRate;
    } else if (b.total !== 0) {
      excluded.push(ccy);
    }
  }

  return {
    equity,
    fxRate: needsFx ? fxRate : 1,
    fxFreshness: needsFx ? fxFreshness : 'NOT_REQUIRED',
    excluded,
  };
};
