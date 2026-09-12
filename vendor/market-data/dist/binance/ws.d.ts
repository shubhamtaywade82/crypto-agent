import type { LiveKlineSubscription, StreamStatus, StreamSubscription } from '../types.js';
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
export declare class BinanceKlineStream {
    private readonly sub;
    private readonly wsBaseUrl;
    private readonly reconnectBackoffMs;
    private readonly maxReconnectBackoffMs;
    private readonly maxReconnectAttempts;
    private ws;
    private status;
    private reconnectAttempts;
    private closed;
    private reconnectTimer;
    constructor(sub: LiveKlineSubscription, config?: BinanceWsConfig);
    /** Open the connection. Resolves once the socket is open. */
    connect(): Promise<void>;
    private scheduleReconnect;
    private setStatus;
    /** Stop the stream and release the socket. Idempotent. */
    unsubscribe(): Promise<void>;
    get currentStatus(): StreamStatus;
}
/**
 * Subscribe to a live Binance kline stream. Returns a handle to
 * unsubscribe and inspect connection state.
 *
 * The callback fires once per *closed* candle — never for the in-progress
 * candle. This matches the deterministic engine's zero-lookahead contract.
 */
export declare function subscribeBinanceKlines(sub: LiveKlineSubscription, config?: BinanceWsConfig): Promise<StreamSubscription>;
//# sourceMappingURL=ws.d.ts.map