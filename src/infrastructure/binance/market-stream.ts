import { parseWsPayload } from '@nemesis-oss/binance-sdk';
import type { WsKlinePayload, WsMarkPricePayload, WsMiniTickerPayload } from '@nemesis-oss/binance-sdk';
import type { Candle, Timeframe } from '../../domain/market/types.js';
import { TIMEFRAMES } from '../../domain/market/types.js';
import type { IMarketDataProvider } from '../broker/broker.js';
import type { EventStore } from '../events/event-store.js';
import type { MarketStateStore } from '../../engines/market-state-store.js';
import { createLogger, type Logger } from '../observability/logger.js';

/**
 * Binance futures multiplexed stream -> MarketStateStore. The socket is
 * injected (WsFactory) so unit tests run without a network. REST remains
 * the cold-start backfill and post-reconnect gap-recovery path.
 */
export type StreamState = 'IDLE' | 'CONNECTING' | 'LIVE' | 'RECONNECTING' | 'DOWN';

export interface WsHandlers {
  readonly onOpen: () => void;
  readonly onMessage: (raw: string) => void;
  readonly onClose: (reason: string) => void;
  readonly onError: (err: Error) => void;
}

export interface WsHandle {
  readonly close: () => void;
}

export type WsFactory = (url: string, handlers: WsHandlers) => WsHandle;

export interface MarketStreamOptions {
  readonly store: MarketStateStore;
  readonly provider: IMarketDataProvider;
  readonly audit?: EventStore;
  readonly url?: string;
  readonly maxRetries?: number;
  readonly backoffBaseMs?: number;
  readonly backoffCapMs?: number;
  readonly now?: () => number;
  readonly log?: Logger;
  /** Socket factory override (tests inject a scripted fake). */
  readonly wsFactory?: WsFactory;
}

const FAPI_TF: Readonly<Record<Timeframe, string>> = {
  '5m': '5m', '15m': '15m', '1h': '1h', '4h': '4h',
};

const streamName = (symbol: string, tf: Timeframe): string =>
  `${symbol.toLowerCase()}@kline_${FAPI_TF[tf]}`;

const toCandle = (k: WsKlinePayload['k']): Candle => ({
  openTime: k.t, open: k.o, high: k.h, low: k.l, close: k.c, volume: k.v,
});

const tfOf = (interval: string): Timeframe =>
  TIMEFRAMES.find((tf) => tf === interval) ?? '5m';

/** Exponential backoff with half-decile jitter, capped. */
const jittered = (attempt: number, baseMs: number, capMs: number): number =>
  Math.min(capMs, baseMs * 2 ** attempt) * (0.5 + Math.random() * 0.5);

/** Minimal structural type for Node's native WebSocket (typed locally). */
interface NativeWebSocketLike {
  addEventListener(type: 'open', cb: () => void): void;
  addEventListener(type: 'message', cb: (ev: { readonly data: unknown }) => void): void;
  addEventListener(type: 'close', cb: (ev: { readonly code: number }) => void): void;
  addEventListener(type: 'error', cb: () => void): void;
  close(): void;
}

const nativeWsFactory: WsFactory = (url, handlers) => {
  const Ctor = (globalThis as typeof globalThis & {
    WebSocket: new (url: string) => NativeWebSocketLike;
  }).WebSocket;
  const socket = new Ctor(url);
  socket.addEventListener('open', (): void => handlers.onOpen());
  socket.addEventListener('message', (ev): void => {
    if (typeof ev.data === 'string') handlers.onMessage(ev.data);
  });
  socket.addEventListener('close', (ev): void => handlers.onClose(`code ${ev.code}`));
  socket.addEventListener('error', (): void => undefined); // close always follows an error
  return { close: (): void => socket.close() };
};

export class BinanceMarketStream {
  private readonly store: MarketStateStore;
  private readonly provider: IMarketDataProvider;
  private readonly audit?: EventStore;
  private readonly url: string;
  private readonly maxRetries: number;
  private readonly backoffBaseMs: number;
  private readonly backoffCapMs: number;
  private readonly now: () => number;
  private readonly log: Logger;
  private readonly wsFactory: WsFactory;
  private readonly symbols = new Set<string>();
  private socket?: WsHandle;
  private stateValue: StreamState = 'IDLE';
  private attempts = 0;
  private reconnectTimer?: NodeJS.Timeout;
  private stopped = true;
  private lastEventAt?: number;

  constructor(opts: MarketStreamOptions) {
    this.store = opts.store;
    this.provider = opts.provider;
    this.audit = opts.audit;
    this.url = opts.url ?? 'wss://fstream.binance.com/stream?streams=';
    this.maxRetries = opts.maxRetries ?? 8;
    this.backoffBaseMs = opts.backoffBaseMs ?? 500;
    this.backoffCapMs = opts.backoffCapMs ?? 30_000;
    this.now = opts.now ?? Date.now;
    this.log = opts.log ?? createLogger('market-stream');
    this.wsFactory = opts.wsFactory ?? nativeWsFactory;
  }

  get state(): StreamState {
    return this.stateValue;
  }

  status(): {
    readonly state: StreamState; readonly symbols: string[];
    readonly attempts: number; readonly lastEventAt?: number;
  } {
    return {
      state: this.stateValue, symbols: [...this.symbols],
      attempts: this.attempts, lastEventAt: this.lastEventAt,
    };
  }

  private setState(next: StreamState): void {
    if (this.stateValue === next) return;
    this.stateValue = next;
    this.audit?.append({
      type: 'market.stream.state',
      payload: { venue: 'binance', state: next, symbols: [...this.symbols], attempts: this.attempts },
    });
  }

  /** Add symbols to the watchlist: REST-seed ladders, then connect. */
  async subscribe(symbols: readonly string[]): Promise<void> {
    const added = symbols.filter((s) => !this.symbols.has(s));
    if (added.length === 0) return;
    for (const s of added) {
      this.symbols.add(s);
      await this.backfill(s);
    }
    this.stopped = false;
    if (!this.socket) this.connect();
  }

  /** Graceful shutdown: no further reconnects after close. */
  stop(): void {
    this.stopped = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = undefined;
    this.socket?.close();
    this.socket = undefined;
    this.setState('IDLE');
  }

  /** REST seed of the full candle ladder so the store is pipeline-ready. */
  private async backfill(symbol: string): Promise<void> {
    const at = this.now();
    for (const tf of TIMEFRAMES) {
      try {
        const candles: Candle[] = await this.provider.getKlines(symbol, tf, 300);
        this.store.backfillCandles(symbol, tf, candles, at);
      } catch (err) {
        this.log.warn('kline backfill failed', { symbol, tf, err: String(err) });
      }
    }
  }

  private connect(): void {
    if (this.symbols.size === 0) return;
    this.setState(this.attempts === 0 ? 'CONNECTING' : 'RECONNECTING');
    this.socket = this.wsFactory(this.multiplexUrl(), {
      onOpen: (): void => this.onOpen(),
      onMessage: (raw: string): void => this.onMessage(raw),
      onClose: (reason: string): void => this.onClose(reason),
      onError: (): void => undefined,
    });
  }

  private multiplexUrl(): string {
    const streams = [...this.symbols].flatMap((s) => [
      ...TIMEFRAMES.map((tf) => streamName(s, tf)),
      `${s.toLowerCase()}@markPrice@1s`,
      `${s.toLowerCase()}@miniTicker`,
    ]);
    return this.url + streams.join('/');
  }

  private onOpen(): void {
    this.attempts = 0;
    this.setState('LIVE');
  }

  private onClose(reason: string): void {
    this.socket = undefined;
    if (this.stopped) return;
    this.setState('DOWN');
    this.audit?.append({
      type: 'market.stream.down', payload: { venue: 'binance', reason },
    });
    if (this.attempts >= this.maxRetries) {
      this.log.error('stream gave up; REST fallback serves market data');
      return;
    }
    const delay = jittered(this.attempts, this.backoffBaseMs, this.backoffCapMs);
    this.attempts += 1;
    this.reconnectTimer = setTimeout((): void => this.connect(), delay);
  }

  private onMessage(raw: string): void {
    this.lastEventAt = this.now();
    let parsed: { stream?: string; data?: unknown };
    try {
      parsed = JSON.parse(raw) as { stream?: string; data?: unknown };
    } catch {
      return;
    }
    const name = parsed.stream ?? '';
    try {
      this.apply(name, parseWsPayload(name, parsed.data));
    } catch {
      this.log.debug('unparsable stream payload ignored', { stream: name });
    }
  }

  private apply(name: string, payload: ReturnType<typeof parseWsPayload>): void {
    const at = this.now();
    if (name.includes('@kline')) {
      const k = payload as WsKlinePayload;
      this.store.upsertKline({ symbol: k.s, timeframe: tfOf(k.k.i), candle: toCandle(k.k), at });
      return;
    }
    if (name.includes('@markPrice')) {
      const m = payload as WsMarkPricePayload;
      this.store.setMarkIndex({ symbol: m.s, mark: m.p, index: m.i, fundingRate: m.r, at });
      return;
    }
    if (name.includes('@miniTicker')) {
      const t = payload as WsMiniTickerPayload;
      this.store.setTicker({ symbol: t.s, price: t.c, at });
    }
  }
}
