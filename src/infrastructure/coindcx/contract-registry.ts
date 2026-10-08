import { z } from 'zod';
import type { IExecutionBroker } from '../broker/broker.js';
import type { ContractSpec } from '../../domain/futures/contract-spec.js';

/**
 * Three-state instrument metadata lookup, mirroring the order truth
 * model: the venue answered with a spec, the venue answered "no such
 * instrument", or the lookup itself failed.
 */
export type ContractSpecLookup =
  | { readonly kind: 'AVAILABLE'; readonly spec: ContractSpec; readonly ageMs: number }
  | { readonly kind: 'UNKNOWN_INSTRUMENT' }
  | { readonly kind: 'LOOKUP_FAILED'; readonly reason: string };

export interface ContractRegistryOptions {
  /** How long a fetched spec is fresh (default 5 min). */
  readonly ttlMs?: number;
  /**
   * How long a KNOWN-GOOD cached spec may still be used when the venue
   * becomes unreachable (default 30 min). Beyond this the spec is
   * treated as unavailable — trading degrades instead of flying blind
   * on arbitrarily old constraints.
   */
  readonly maxStaleMs?: number;
}

interface CacheEntry {
  readonly spec: ContractSpec;
  readonly at: number;
}

/** Structural sanity gate — a corrupt venue payload must not size trades. */
export const isSaneSpec = (s: ContractSpec): boolean =>
  Number.isFinite(s.lotSize) && s.lotSize > 0 &&
  Number.isFinite(s.tickSize) && s.tickSize > 0 &&
  Number.isFinite(s.minQuantity) && s.minQuantity > 0 &&
  Number.isFinite(s.maxQuantity) && s.maxQuantity >= s.minQuantity &&
  Number.isFinite(s.minNotional) && s.minNotional >= 0 &&
  Number.isFinite(s.maxLeverage) && s.maxLeverage >= 1;

/**
 * Safe cached contract-specification registry.
 *
 * Correctness rules (kernel v3):
 *  1. Sizing and validation use REAL venue instrument metadata
 *     (lot size, min quantity, min notional, max leverage) — never a
 *     synthetic fallback invented by the caller.
 *  2. A lookup failure is a DEGRADED-TRADING condition, not an excuse
 *     to substitute made-up constraints.
 *  3. A cached KNOWN-GOOD spec may be served while the venue is
 *     unreachable, but only within `maxStaleMs`.
 */
export class ContractRegistry {
  private readonly ttlMs: number;
  private readonly maxStaleMs: number;
  private readonly cache = new Map<string, CacheEntry>();
  private readonly missing = new Map<string, number>();

  constructor(opts: ContractRegistryOptions = {}) {
    this.ttlMs = opts.ttlMs ?? 5 * 60_000;
    this.maxStaleMs = opts.maxStaleMs ?? 30 * 60_000;
  }

  peek(pair: string): { spec: ContractSpec; ageMs: number } | undefined {
    const entry = this.cache.get(pair.toUpperCase());
    if (!entry) return undefined;
    return { spec: entry.spec, ageMs: Date.now() - entry.at };
  }

  /** Cache statistics for health surfaces. */
  stats(): { cached: number; missing: number } {
    return { cached: this.cache.size, missing: this.missing.size };
  }

  async lookup(broker: IExecutionBroker, pair: string): Promise<ContractSpecLookup> {
    const key = pair.toUpperCase();
    const entry = this.cache.get(key);

    if (entry) {
      const ageMs = Date.now() - entry.at;
      if (ageMs < this.ttlMs) {
        return { kind: 'AVAILABLE', spec: entry.spec, ageMs };
      }
      // Stale: try to refresh; fall back to the known-good spec only
      // within the staleness bound and only when the venue is
      // unreachable (an affirmative UNKNOWN_INSTRUMENT stays truthful).
      const refreshed = await this.fetchAndCache(broker, key);
      if (refreshed.kind === 'AVAILABLE') return refreshed;
      if (refreshed.kind === 'LOOKUP_FAILED' && ageMs < this.maxStaleMs) {
        return { kind: 'AVAILABLE', spec: entry.spec, ageMs };
      }
      return refreshed;
    }

    return this.fetchAndCache(broker, key);
  }

  /**
   * Resolve a spec or throw. The thrown message distinguishes
   * unavailable metadata from lookup failure so the pipeline can reject
   * with a precise, auditable reason.
   */
  async require(broker: IExecutionBroker, pair: string): Promise<ContractSpec> {
    const result = await this.lookup(broker, pair);
    switch (result.kind) {
      case 'AVAILABLE':
        return result.spec;
      case 'UNKNOWN_INSTRUMENT':
        throw new Error(`instrument ${pair} unknown at venue ${broker.id}`);
      case 'LOOKUP_FAILED':
        throw new Error(
          `instrument spec for ${pair} unavailable (trading degraded): ${result.reason}`
        );
    }
  }

  private async fetchAndCache(
    broker: IExecutionBroker,
    key: string
  ): Promise<ContractSpecLookup> {
    try {
      const spec = await broker.getInstrument(key);
      if (!spec) {
        this.missing.set(key, Date.now());
        return { kind: 'UNKNOWN_INSTRUMENT' };
      }
      if (!isSaneSpec(spec)) {
        // A corrupt payload is a lookup failure, not a spec.
        return {
          kind: 'LOOKUP_FAILED',
          reason: `venue returned structurally invalid spec for ${key}`,
        };
      }
      this.cache.set(key, { spec, at: Date.now() });
      this.missing.delete(key);
      return { kind: 'AVAILABLE', spec, ageMs: 0 };
    } catch (err) {
      return {
        kind: 'LOOKUP_FAILED',
        reason: err instanceof Error ? err.message : String(err),
      };
    }
  }
}

/**
 * CoinDCX publishes two instrument sources that disagree. `markets_details`
 * carries spot-style step/min/max; the futures instrument carries the
 * perpetual's tick, leverage and notional rules. Neither is complete alone,
 * so every shared constraint takes the stricter of the two venue values.
 */

const FUTURES_INSTRUMENT_URL = 'https://api.coindcx.com/exchange/v1/derivatives/futures/data/instrument';
const MARGIN_CURRENCY = 'USDT';
/** Absent from both venue payloads; sizing and risk never read it. Kept only for ContractSpec shape. */
const MAINTENANCE_MARGIN_RATE_UNVERIFIED = 0.005;

const marketRowSchema = z.object({
  pair: z.string(),
  status: z.string(),
  step: z.number().positive(),
  min_quantity: z.number().positive(),
  max_quantity: z.number().positive(),
  min_notional: z.number().nonnegative(),
});

const futuresInstrumentSchema = z.object({
  pair: z.string(),
  status: z.string(),
  kind: z.string(),
  margin_currency_short_name: z.string(),
  position_currency_short_name: z.string(),
  price_increment: z.number().positive(),
  quantity_increment: z.number().positive(),
  min_quantity: z.number().positive(),
  max_quantity: z.number().positive(),
  min_notional: z.number().nonnegative(),
  max_leverage_long: z.number().min(1),
  max_leverage_short: z.number().min(1),
});

const futuresResponseSchema = z.object({ instrument: futuresInstrumentSchema });

export type MarketRow = z.infer<typeof marketRowSchema>;
export type FuturesInstrument = z.infer<typeof futuresInstrumentSchema>;

/**
 * Public endpoint, no credentials. Timeouts, non-2xx responses and schema
 * mismatches throw; the ContractRegistry classifies them as LOOKUP_FAILED.
 */
export const fetchFuturesInstrument = async (
  pair: string,
  timeoutMs: number
): Promise<FuturesInstrument> => {
  const url = new URL(FUTURES_INSTRUMENT_URL);
  url.searchParams.set('pair', pair);
  url.searchParams.set('margin_currency_short_name', MARGIN_CURRENCY);
  const res = await fetch(url, {
    headers: { accept: 'application/json' },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`futures instrument ${pair} HTTP ${res.status}`);
  const parsed = futuresResponseSchema.safeParse(await res.json());
  if (!parsed.success) {
    throw new Error(`futures instrument ${pair} failed schema validation: ${parsed.error.message}`);
  }
  if (parsed.data.instrument.pair !== pair) {
    throw new Error(`futures instrument returned ${parsed.data.instrument.pair} for ${pair}`);
  }
  return parsed.data.instrument;
};

const pairOf = (row: unknown): unknown =>
  typeof row === 'object' && row !== null && 'pair' in row ? row.pair : undefined;

/**
 * markets_details is an unindexed list of every market. `undefined` means the
 * venue does not list the pair (an affirmative "unknown"), not a lookup error.
 */
export const pickMarketRow = (rows: unknown, pair: string): MarketRow | undefined => {
  if (!Array.isArray(rows)) throw new Error('markets_details payload is not an array');
  const row: unknown = rows.find((candidate: unknown) => pairOf(candidate) === pair);
  if (row === undefined) return undefined;
  const parsed = marketRowSchema.safeParse(row);
  if (!parsed.success) {
    throw new Error(`markets_details row for ${pair} failed schema validation: ${parsed.error.message}`);
  }
  return parsed.data;
};

/**
 * Stricter-of-both: a quantity or notional that clears this spec clears
 * either endpoint. Leverage comes only from the futures record, because
 * markets_details reports max_leverage 0 for these pairs and would clamp
 * every trade to zero leverage.
 */
export const mergeSpec = (
  pair: string,
  market: MarketRow,
  futures: FuturesInstrument
): ContractSpec => {
  const isPerp = futures.kind === 'perpetual' && futures.status === 'active';
  if (!isPerp || futures.margin_currency_short_name !== MARGIN_CURRENCY) {
    throw new Error(
      `instrument ${pair} is not an active ${MARGIN_CURRENCY} perpetual ` +
      `(kind=${futures.kind}, status=${futures.status}, margin=${futures.margin_currency_short_name})`
    );
  }
  if (market.status !== 'active') {
    throw new Error(`instrument ${pair} is not active in markets_details (status=${market.status})`);
  }
  return {
    pair,
    baseAsset: futures.position_currency_short_name,
    quoteAsset: MARGIN_CURRENCY,
    tickSize: futures.price_increment,
    lotSize: Math.max(market.step, futures.quantity_increment),
    minQuantity: Math.max(market.min_quantity, futures.min_quantity),
    maxQuantity: Math.min(market.max_quantity, futures.max_quantity),
    minNotional: Math.max(market.min_notional, futures.min_notional),
    maxLeverage: Math.min(futures.max_leverage_long, futures.max_leverage_short),
    maintenanceMarginRate: MAINTENANCE_MARGIN_RATE_UNVERIFIED,
  };
};
