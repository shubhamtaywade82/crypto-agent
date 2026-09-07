/**
 * Cross-venue state — first-class awareness that reference data
 * (Binance) and execution venue (CoinDCX) are DIFFERENT markets.
 *
 * Executing on a venue while reading prices from another means every
 * decision carries basis, spread and execution-premium risk that the
 * single-venue MarketState cannot see. This module normalizes the two
 * venues' top-of-book into one comparable snapshot.
 */

export interface VenueQuote {
  readonly venue: 'BINANCE' | 'COINDCX';
  readonly bid: number;
  readonly ask: number;
  readonly last: number;
  readonly at: number;
}

export type VenueHealth = 'OK' | 'STALE' | 'UNAVAILABLE';

export interface CrossVenueState {
  readonly binance: VenueQuote;
  readonly coindcx?: VenueQuote;
  /** Coindcx mid normalized into USDT (divided by the live USDT/INR rate). */
  readonly coindcxMidUsdt?: number;
  /** USDT/INR rate used for normalization (1 for USDT-margined pairs). */
  readonly fxRate: number;
  /** coindcxMidUsdt - binanceMid: positive = CoinDCX trades rich. */
  readonly basis?: number;
  /** basis in basis points of the binance mid. */
  readonly basisBps?: number;
  /** Venue spread in bps on CoinDCX (execution cost proxy). */
  readonly coindcxSpreadBps?: number;
  readonly binanceSpreadBps: number;
  readonly health: VenueHealth;
  readonly at: number;
}

export const STALE_QUOTE_MS = 30_000;

const mid = (q: VenueQuote): number => (q.bid + q.ask) / 2;

export const quoteHealth = (q: VenueQuote | undefined, now = Date.now()): VenueHealth => {
  if (!q || q.bid <= 0 || q.ask <= 0) return 'UNAVAILABLE';
  return now - q.at <= STALE_QUOTE_MS ? 'OK' : 'STALE';
};

/**
 * Build the cross-venue snapshot. CoinDCX quotes are INR or USDT
 * denominated; INR quotes are normalized through the live FX rate so
 * both legs are comparable in USDT.
 */
export const buildCrossVenueState = (
  binance: VenueQuote,
  coindcx: VenueQuote | undefined,
  fxRate = 1,
  now = Date.now()
): CrossVenueState => {
  const binanceMid = mid(binance);
  const health = worstHealth(quoteHealth(binance, now), quoteHealth(coindcx, now));

  if (!coindcx) {
    return {
      binance,
      fxRate,
      binanceSpreadBps: spreadBps(binance.bid, binance.ask, binanceMid),
      health,
      at: now,
    };
  }

  const coindcxMid = mid(coindcx);
  const coindcxMidUsdt = coindcxMid / fxRate;
  const basis = coindcxMidUsdt - binanceMid;
  return {
    binance,
    coindcx,
    coindcxMidUsdt,
    fxRate,
    basis,
    basisBps: binanceMid > 0 ? (basis / binanceMid) * 10_000 : undefined,
    coindcxSpreadBps: spreadBps(coindcx.bid, coindcx.ask, coindcxMid),
    binanceSpreadBps: spreadBps(binance.bid, binance.ask, binanceMid),
    health,
    at: now,
  };
};

/** Execution guidance derived from cross-venue conditions. */
export const crossVenueExecutionRisk = (
  s: CrossVenueState,
  maxBasisBps = 50,
  maxSpreadBps = 30
): { tradable: boolean; reasons: readonly string[] } => {
  const reasons: string[] = [];
  if (s.health === 'UNAVAILABLE') reasons.push('venue quote unavailable');
  if (s.health === 'STALE') reasons.push('venue quote stale');
  if (s.basisBps !== undefined && Math.abs(s.basisBps) > maxBasisBps) {
    reasons.push(`basis ${s.basisBps.toFixed(1)}bps beyond ${maxBasisBps}bps`);
  }
  if (s.coindcxSpreadBps !== undefined && s.coindcxSpreadBps > maxSpreadBps) {
    reasons.push(`coindcx spread ${s.coindcxSpreadBps.toFixed(1)}bps beyond ${maxSpreadBps}bps`);
  }
  return { tradable: reasons.length === 0, reasons };
};

const spreadBps = (bid: number, ask: number, midPrice: number): number =>
  midPrice > 0 ? ((ask - bid) / midPrice) * 10_000 : Number.POSITIVE_INFINITY;

const worstHealth = (a: VenueHealth, b: VenueHealth): VenueHealth => {
  const rank: Record<VenueHealth, number> = { OK: 0, STALE: 1, UNAVAILABLE: 2 };
  return rank[a] >= rank[b] ? a : b;
};
