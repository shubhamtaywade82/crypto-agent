import type { Candle, Timeframe } from '../domain/market/types.js';
import { TIMEFRAMES } from '../domain/market/types.js';
import type { BookLevel, MicrostructureView, TradePrint } from '../domain/market/microstructure.js';
import { computeMicrostructure } from './microstructure-engine.js';

/**
 * In-memory market-state cache fed by the Binance WS streams (event-driven
 * runtime) with REST as the cold-start/recovery backfill path. Deterministic:
 * candles are keyed by openTime and kept sorted, so replaying the same
 * updates always produces the same book.
 */
export interface SymbolSnapshot {
  readonly symbol: string;
  readonly candles: Readonly<Record<Timeframe, readonly Candle[]>>;
  readonly last?: number;
  readonly mark?: number;
  readonly index?: number;
  readonly fundingRate?: number;
  readonly openInterest?: number;
  readonly openInterestChange?: number;
  /** Best bid/ask from the Binance book-ticker stream (real top-of-book). */
  readonly bestBid?: number;
  readonly bestAsk?: number;
  readonly bestQuoteAt?: number;
  readonly bids: readonly BookLevel[];
  readonly asks: readonly BookLevel[];
  readonly trades: readonly TradePrint[];
  /** Bumps on every tape mutation — UI can subscribe without deep compare. */
  readonly tradeSeq: number;
  readonly microstructure?: MicrostructureView;
  readonly updatedAt: number;
}

export interface KlineUpdate {
  readonly symbol: string;
  readonly timeframe: Timeframe;
  readonly candle: Candle;
  readonly at: number;
}

export interface TickerUpdate {
  readonly symbol: string;
  readonly price: number;
  readonly at: number;
}

export interface BookTickerUpdate {
  readonly symbol: string;
  readonly bid: number;
  readonly ask: number;
  readonly at: number;
}

export interface MarkIndexUpdate {
  readonly symbol: string;
  readonly mark: number;
  readonly index: number;
  readonly fundingRate?: number;
  readonly at: number;
}

export interface OpenInterestUpdate {
  readonly symbol: string;
  readonly openInterest: number;
  readonly changePct: number;
  readonly at: number;
}

export interface DepthUpdate {
  readonly symbol: string;
  readonly bids: readonly BookLevel[];
  readonly asks: readonly BookLevel[];
  readonly at: number;
}

const TRADE_CAP = 80;
const DEPTH_LEVELS = 10;

const CANDLE_CAP: Readonly<Record<Timeframe, number>> = {
  '5m': 300, '15m': 300, '1h': 300, '4h': 220,
};

/** Per-symbol mutable book (never leaves the store un-cloned). */
interface SymbolBook {
  readonly candles: Map<Timeframe, Map<number, Candle>>;
  last?: number;
  mark?: number;
  index?: number;
  fundingRate?: number;
  openInterest?: number;
  openInterestChange?: number;
  bestBid?: number;
  bestAsk?: number;
  bestQuoteAt?: number;
  bids: BookLevel[];
  asks: BookLevel[];
  trades: TradePrint[];
  tradeSeq: number;
  lastEventAt?: number;
}

const emptyBook = (): SymbolBook => ({
  candles: new Map(TIMEFRAMES.map((tf) => [tf, new Map<number, Candle>()] as const)),
  bids: [],
  asks: [],
  trades: [],
  tradeSeq: 0,
});

const capCandles = (map: Map<number, Candle>, cap: number): Candle[] => {
  const sorted = [...map.values()].sort((a, b) => a.openTime - b.openTime);
  return sorted.length > cap ? sorted.slice(sorted.length - cap) : sorted;
};

export class MarketStateStore {
  private readonly books = new Map<string, SymbolBook>();

  private book(symbol: string): SymbolBook {
    let b = this.books.get(symbol);
    if (!b) {
      b = emptyBook();
      this.books.set(symbol, b);
    }
    return b;
  }

  private touch(b: SymbolBook, at: number): void {
    b.lastEventAt = Math.max(b.lastEventAt ?? 0, at);
  }

  /** Replace-or-insert a candle keyed by openTime (WS sends in-progress updates). */
  upsertKline(u: KlineUpdate): void {
    const b = this.book(u.symbol);
    b.candles.get(u.timeframe)?.set(u.candle.openTime, u.candle);
    this.touch(b, u.at);
  }

  /** Cold-start/recovery path: seed a full ladder from REST klines. */
  backfillCandles(symbol: string, timeframe: Timeframe, candles: readonly Candle[], at: number): void {
    const b = this.book(symbol);
    const map = b.candles.get(timeframe);
    if (map) for (const c of candles) map.set(c.openTime, c);
    this.touch(b, at);
  }

  setTicker(u: TickerUpdate): void {
    const b = this.book(u.symbol);
    b.last = u.price;
    this.touch(b, u.at);
  }

  setBookTicker(u: BookTickerUpdate): void {
    if (!Number.isFinite(u.bid) || !Number.isFinite(u.ask) || u.bid <= 0 || u.ask <= 0) return;
    const b = this.book(u.symbol);
    b.bestBid = u.bid;
    b.bestAsk = u.ask;
    b.bestQuoteAt = u.at;
    if (b.last === undefined) b.last = (u.bid + u.ask) / 2;
    if (b.mark === undefined) b.mark = (u.bid + u.ask) / 2;
    this.touch(b, u.at);
  }

  setMarkIndex(u: MarkIndexUpdate): void {
    const b = this.book(u.symbol);
    b.mark = u.mark;
    b.index = u.index;
    if (u.fundingRate !== undefined) b.fundingRate = u.fundingRate;
    this.touch(b, u.at);
  }

  setOpenInterest(u: OpenInterestUpdate): void {
    const b = this.book(u.symbol);
    b.openInterest = u.openInterest;
    b.openInterestChange = u.changePct;
    this.touch(b, u.at);
  }

  setDepth(u: DepthUpdate): void {
    const b = this.book(u.symbol);
    b.bids = u.bids.slice(0, DEPTH_LEVELS);
    b.asks = u.asks.slice(0, DEPTH_LEVELS);
    if (b.bids[0] && b.asks[0]) {
      b.bestBid = b.bids[0].price;
      b.bestAsk = b.asks[0].price;
      b.bestQuoteAt = u.at;
      if (b.last === undefined) b.last = (b.bids[0].price + b.asks[0].price) / 2;
      if (b.mark === undefined) b.mark = (b.bids[0].price + b.asks[0].price) / 2;
    }
    this.touch(b, u.at);
  }

  pushTrade(symbol: string, trade: TradePrint): void {
    const b = this.book(symbol);
    b.trades = [...b.trades, trade].slice(-TRADE_CAP);
    b.last = trade.price;
    b.tradeSeq += 1;
    this.touch(b, trade.at);
  }

  /** REST recovery: merge deduped prints, keep chronological tail. */
  mergeTrades(symbol: string, incoming: readonly TradePrint[]): void {
    if (incoming.length === 0) return;
    const b = this.book(symbol);
    const byKey = new Map<string, TradePrint>();
    for (const t of [...b.trades, ...incoming]) {
      byKey.set(`${t.at}:${t.price}:${t.qty}`, t);
    }
    b.trades = [...byKey.values()].sort((a, c) => a.at - c.at).slice(-TRADE_CAP);
    if (b.trades.length > 0 && b.last === undefined) {
      b.last = b.trades[b.trades.length - 1]?.price;
    }
    b.tradeSeq += 1;
    this.touch(b, Date.now());
  }

  microstructureOf(symbol: string): MicrostructureView | undefined {
    const b = this.books.get(symbol);
    if (!b || b.bids.length === 0 || b.asks.length === 0) return undefined;
    const mid = b.last ?? (b.bestBid! + b.bestAsk!) / 2;
    return computeMicrostructure({ bids: b.bids, asks: b.asks }, b.trades, mid, b.lastEventAt ?? Date.now());
  }

  /** Full snapshot for one symbol (undefined when nothing was ever stored). */
  snapshot(symbol: string): SymbolSnapshot | undefined {
    const b = this.books.get(symbol);
    if (!b || b.lastEventAt === undefined) return undefined;
    const candles = Object.fromEntries(
      TIMEFRAMES.map((tf) => [tf, capCandles(b.candles.get(tf)!, CANDLE_CAP[tf])])
    ) as Record<Timeframe, Candle[]>;
    const mid = (b.bestBid !== undefined && b.bestAsk !== undefined)
      ? (b.bestBid + b.bestAsk) / 2
      : (b.bids[0] && b.asks[0])
        ? (b.bids[0].price + b.asks[0].price) / 2
        : undefined;
    const lastTrade = b.trades.length > 0 ? b.trades[b.trades.length - 1]?.price : undefined;
    const last = b.last ?? lastTrade ?? mid;
    const mark = b.mark ?? last ?? mid;
    return {
      symbol, candles, last, mark, index: b.index,
      fundingRate: b.fundingRate, openInterest: b.openInterest,
      openInterestChange: b.openInterestChange,
      bestBid: b.bestBid, bestAsk: b.bestAsk, bestQuoteAt: b.bestQuoteAt,
      bids: b.bids, asks: b.asks, trades: b.trades, tradeSeq: b.tradeSeq,
      microstructure: this.microstructureOf(symbol),
      updatedAt: b.lastEventAt,
    };
  }

  /** Age of the most recent event for the symbol; undefined = never seen. */
  stalenessMs(symbol: string, now: number = Date.now()): number | undefined {
    const b = this.books.get(symbol);
    if (!b || b.lastEventAt === undefined) return undefined;
    return Math.max(0, now - b.lastEventAt);
  }

  isFresh(symbol: string, maxAgeMs: number, now: number = Date.now()): boolean {
    const age = this.stalenessMs(symbol, now);
    return age !== undefined && age <= maxAgeMs;
  }

  symbols(): string[] {
    return [...this.books.keys()];
  }
}
