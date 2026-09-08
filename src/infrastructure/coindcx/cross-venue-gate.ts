import type { CoinDCXClient, OrderBookResponse } from '@nemesis-oss/coindcx-sdk';
import {
  buildCrossVenueState, crossVenueExecutionRisk, STALE_QUOTE_MS,
  type CrossVenueState, type VenueQuote,
} from '../../domain/market/cross-venue.js';
import type { SymbolRouter } from './symbol-router.js';

/**
 * Live cross-venue snapshot source: CoinDCX futures order book vs the
 * Binance reference ticker, normalized to a USDT basis through the
 * routed pair's FX rate.
 *
 * This is the runtime wiring for the previously dormant CrossVenueState
 * domain (ROADMAP Phase 2.5): executing on CoinDCX while reading Binance
 * prices carries basis/spread/premium risk the single-venue MarketState
 * cannot see, so the pipeline consults this gate before risking capital.
 *
 * Fail-safe: ANY failure to build the snapshot (outage, auth, rate
 * limit) reports NOT tradable — consistent with "CoinDCX down = no new
 * risk".
 */
export interface CrossVenueEvaluation {
  readonly tradable: boolean;
  readonly reasons: readonly string[];
  readonly state?: CrossVenueState;
}

const bestBid = (levels: Record<string, number | string>): number => {
  const prices = Object.keys(levels).map(Number).filter(Number.isFinite);
  return prices.length > 0 ? Math.max(...prices) : 0;
};

const bestAsk = (levels: Record<string, number | string>): number => {
  const prices = Object.keys(levels).map(Number).filter(Number.isFinite);
  return prices.length > 0 ? Math.min(...prices) : 0;
};

export interface CrossVenueGateConfig {
  readonly maxBasisBps?: number;
  readonly maxSpreadBps?: number;
}

export class CrossVenueGate {
  private readonly client: CoinDCXClient;
  private readonly router: SymbolRouter;
  private readonly binanceTicker: (symbol: string) => Promise<number>;
  private readonly binanceQuote:
    | ((symbol: string) => { readonly bid: number; readonly ask: number; readonly at: number } | undefined)
    | undefined;
  private readonly cfg: CrossVenueGateConfig;

  constructor(
    deps: {
      readonly client: CoinDCXClient;
      readonly router: SymbolRouter;
      readonly binanceTicker: (symbol: string) => Promise<number>;
      /** Real Binance top-of-book source (WS book ticker); undefined = absent/stale. */
      readonly binanceQuote?:
        | ((symbol: string) => { readonly bid: number; readonly ask: number; readonly at: number } | undefined)
        | undefined;
    },
    cfg: CrossVenueGateConfig = {}
  ) {
    this.client = deps.client;
    this.router = deps.router;
    this.binanceTicker = deps.binanceTicker;
    this.binanceQuote = deps.binanceQuote;
    this.cfg = cfg;
  }

  /** Evaluate execution conditions for a Binance-style symbol. */
  async evaluate(symbol: string): Promise<CrossVenueEvaluation> {
    try {
      const routed = await this.router.resolve(symbol);
      const [book, binanceLast] = await Promise.all([
        this.client.futures.market.getOrderBook(routed.pair) as
          Promise<OrderBookResponse>,
        this.binanceTicker(symbol),
      ]);
      const cdqx = this.coindcxQuote(book);
      const binance = this.binanceQuoteOf(symbol, binanceLast);
      const fx = routed.quote === 'INR' ? routed.fxRate : 1;
      const state: CrossVenueState = {
        ...buildCrossVenueState(binance, cdqx, fx),
        binanceQuoteSource: binance.source,
      };
      const risk = crossVenueExecutionRisk(
        state, this.cfg.maxBasisBps ?? 50, this.cfg.maxSpreadBps ?? 30
      );
      return { ...risk, state };
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      return { tradable: false, reasons: [`cross-venue snapshot unavailable: ${reason}`] };
    }
  }

  /**
   * Prefer the REAL Binance book-ticker bid/ask when fresh; fall back to
   * the last-price proxy (bid=ask=last) only when no fresh book quote is
   * available — the source is annotated on the state for auditability.
   */
  private binanceQuoteOf(
    symbol: string, last: number
  ): VenueQuote & { readonly source: 'book_ticker' | 'last_proxy' } {
    const q = this.binanceQuote?.(symbol);
    const fresh = q && q.bid > 0 && q.ask > 0 && Date.now() - q.at <= STALE_QUOTE_MS;
    if (q && fresh) {
      return {
        venue: 'BINANCE', bid: q.bid, ask: q.ask, last, at: q.at, source: 'book_ticker',
      };
    }
    return { venue: 'BINANCE', bid: last, ask: last, last, at: Date.now(), source: 'last_proxy' };
  }

  private coindcxQuote(book: OrderBookResponse): VenueQuote {
    const bid = bestBid(book.bids ?? {});
    const ask = bestAsk(book.asks ?? {});
    const mid = bid > 0 && ask > 0 ? (bid + ask) / 2 : 0;
    return {
      venue: 'COINDCX', bid, ask, last: mid,
      at: typeof book.timestamp === 'number' ? book.timestamp : Date.now(),
    };
  }
}
