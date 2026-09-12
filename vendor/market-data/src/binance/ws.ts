import { Decimal } from 'decimal.js';
import type { Candle, Timeframe } from '@nemesis-oss/market-events';
import { WebSocket } from 'ws';

import { BINANCE_INTERVAL_MAP, BINANCE_WS_FUTURES } from './rest.js';
import type {
  LiveKlineSubscription,
  StreamStatus,
  StreamSubscription,
} from '../types.js';

/**
 * Binance USDⓈ-M futures kline WebSocket message.
 * @see https://binance-docs.github.io/apidocs/futures/en/#kline-candlestick-streams
 */
interface BinanceKlineMessage {
  e: 'kline';
  E: number; // event time
  s: string; // symbol
  k: {
    t: number; // kline start time
    T: number; // kline close time
    s: string; // symbol
    i: string; // interval
    o: string; // open
    c: string; // close
    h: string; // high
    l: string; // low
    v: string; // base volume
    x: boolean; // is this kline closed?
    q: string; // quote volume
  };
}

export interface BinanceWsConfig {
  readonly wsBaseUrl?: string | undefined;
  /** Initial reconnect backoff, ms. Default 1_000. */
  readonly reconnectBackoffMs?: number | undefined;
  /** Max reconnect backoff cap, ms. Default 30_000. */
  readonly maxReconnectBackoffMs?: number | undefined;
  /** Max reconnect attempts before giving up. Default Infinity. */
  readonly maxReconnectAttempts?: number | undefined;
  /** Ping interval, ms. Binance sends pings every 3 min; we send pongs automatically. */
  readonly pingIntervalMs?: number | undefined;
}

/**
 * Binance USDⓈ-M futures kline WebSocket subscriber.
 *
 * Lifecycle:
 *  1. Connect to `<wsBase>/ws/<symbol>@kline_<interval>`.
 *  2. On each kline message: if `k.x === true` (kline closed), normalize to
 *     a {@link Candle} and fire `onCandle`.
 *  3. On socket close: exponential-backoff reconnect, up to
 *     `maxReconnectAttempts`.
 *  4. On unrecoverable error: fire `onError` and stop.
 *
 * The subscriber never fires for the in-progress candle — only closed
 * candles reach `onCandle`. This matches the deterministic engine's
 * zero-lookahead contract: a closed candle is immutable.
 */
export class BinanceKlineStream {
  private readonly wsBaseUrl: string;
  private readonly reconnectBackoffMs: number;
  private readonly maxReconnectBackoffMs: number;
  private readonly maxReconnectAttempts: number;

  private ws: WebSocket | null = null;
  private status: StreamStatus = 'closed';
  private reconnectAttempts = 0;
  private closed = false;
  private reconnectTimer: NodeJS.Timeout | null = null;

  constructor(
    private readonly sub: LiveKlineSubscription,
    config: BinanceWsConfig = {},
  ) {
    this.wsBaseUrl = config.wsBaseUrl ?? BINANCE_WS_FUTURES;
    this.reconnectBackoffMs = config.reconnectBackoffMs ?? 1_000;
    this.maxReconnectBackoffMs = config.maxReconnectBackoffMs ?? 30_000;
    this.maxReconnectAttempts = config.maxReconnectAttempts ?? Infinity;
  }

  /** Open the connection. Resolves once the socket is open. */
  async connect(): Promise<void> {
    if (this.ws || this.closed) return;
    const interval = BINANCE_INTERVAL_MAP[this.sub.timeframe];
    const stream = `${this.sub.symbol.toLowerCase()}@kline_${interval}`;
    const url = `${this.wsBaseUrl}/ws/${stream}`;

    this.setStatus('connecting');

    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url);
      this.ws = ws;

      ws.on('open', () => {
        this.reconnectAttempts = 0;
        this.setStatus('open');
        resolve();
      });

      ws.on('message', (data: Buffer | string) => {
        try {
          const msg = JSON.parse(data.toString()) as BinanceKlineMessage;
          if (msg.e !== 'kline') return;
          if (!msg.k.x) return; // only closed candles

          const candle: Candle = {
            timestamp: msg.k.t,
            open: new Decimal(msg.k.o),
            high: new Decimal(msg.k.h),
            low: new Decimal(msg.k.l),
            close: new Decimal(msg.k.c),
            volume: new Decimal(msg.k.v),
          };
          this.sub.onCandle(candle);
        } catch (err) {
          // Malformed message: surface but do not kill the connection.
          this.sub.onError?.(
            err instanceof Error ? err : new Error(String(err)),
          );
        }
      });

      ws.on('close', () => {
        this.ws = null;
        if (this.closed) {
          this.setStatus('closed');
          return;
        }
        this.scheduleReconnect();
      });

      ws.on('error', (err: Error) => {
        this.sub.onError?.(err);
        // The 'close' event will fire next and trigger reconnect logic.
        if (this.status !== 'open') {
          reject(err);
        }
      });
    });
  }

  private scheduleReconnect(): void {
    if (this.closed) return;
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      this.setStatus('error');
      this.sub.onError?.(
        new Error(
          `Max reconnect attempts (${this.maxReconnectAttempts}) reached`,
        ),
      );
      return;
    }

    this.setStatus('reconnecting');
    const backoff = Math.min(
      this.reconnectBackoffMs * Math.pow(2, this.reconnectAttempts),
      this.maxReconnectBackoffMs,
    );
    this.reconnectAttempts++;

    this.reconnectTimer = setTimeout(() => {
      this.connect().catch((err) => {
        // connect() rejects on first-connection failure; the 'close' handler
        // will retry. Swallow to avoid unhandled rejection.
        this.sub.onError?.(err instanceof Error ? err : new Error(String(err)));
      });
    }, backoff);
  }

  private setStatus(status: StreamStatus): void {
    this.status = status;
    this.sub.onStatus?.(status);
  }

  /** Stop the stream and release the socket. Idempotent. */
  async unsubscribe(): Promise<void> {
    this.closed = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      const ws = this.ws;
      this.ws = null;
      await new Promise<void>((resolve) => {
        ws.once('close', () => resolve());
        try {
          ws.close();
        } catch {
          resolve();
        }
      });
    }
    this.setStatus('closed');
  }

  get currentStatus(): StreamStatus {
    return this.status;
  }
}

/**
 * Subscribe to a live Binance kline stream. Returns a handle to
 * unsubscribe and inspect connection state.
 *
 * The callback fires once per *closed* candle — never for the in-progress
 * candle. This matches the deterministic engine's zero-lookahead contract.
 */
export async function subscribeBinanceKlines(
  sub: LiveKlineSubscription,
  config?: BinanceWsConfig,
): Promise<StreamSubscription> {
  const stream = new BinanceKlineStream(sub, config);
  await stream.connect();
  return {
    unsubscribe: () => stream.unsubscribe(),
    get status() {
      return stream.currentStatus;
    },
  };
}
