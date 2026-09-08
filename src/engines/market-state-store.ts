import type { Candle, Timeframe } from '../domain/market/types.js';
import { TIMEFRAMES } from '../domain/market/types.js';

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
  lastEventAt?: number;
}

const emptyBook = (): SymbolBook => ({
  candles: new Map(TIMEFRAMES.map((tf) => [tf, new Map<number, Candle>()] as const)),
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

  /** Full snapshot for one symbol (undefined when nothing was ever stored). */
  snapshot(symbol: string): SymbolSnapshot | undefined {
    const b = this.books.get(symbol);
    if (!b || b.lastEventAt === undefined) return undefined;
    const candles = Object.fromEntries(
      TIMEFRAMES.map((tf) => [tf, capCandles(b.candles.get(tf)!, CANDLE_CAP[tf])])
    ) as Record<Timeframe, Candle[]>;
    return {
      symbol, candles, last: b.last, mark: b.mark, index: b.index,
      fundingRate: b.fundingRate, openInterest: b.openInterest,
      openInterestChange: b.openInterestChange, updatedAt: b.lastEventAt,
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
