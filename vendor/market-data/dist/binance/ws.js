import { Decimal } from 'decimal.js';
import { WebSocket } from 'ws';
import { BINANCE_INTERVAL_MAP, BINANCE_WS_FUTURES } from './rest.js';
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
    sub;
    wsBaseUrl;
    reconnectBackoffMs;
    maxReconnectBackoffMs;
    maxReconnectAttempts;
    ws = null;
    status = 'closed';
    reconnectAttempts = 0;
    closed = false;
    reconnectTimer = null;
    constructor(sub, config = {}) {
        this.sub = sub;
        this.wsBaseUrl = config.wsBaseUrl ?? BINANCE_WS_FUTURES;
        this.reconnectBackoffMs = config.reconnectBackoffMs ?? 1_000;
        this.maxReconnectBackoffMs = config.maxReconnectBackoffMs ?? 30_000;
        this.maxReconnectAttempts = config.maxReconnectAttempts ?? Infinity;
    }
    /** Open the connection. Resolves once the socket is open. */
    async connect() {
        if (this.ws || this.closed)
            return;
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
            ws.on('message', (data) => {
                try {
                    const msg = JSON.parse(data.toString());
                    if (msg.e !== 'kline')
                        return;
                    if (!msg.k.x)
                        return; // only closed candles
                    const candle = {
                        timestamp: msg.k.t,
                        open: new Decimal(msg.k.o),
                        high: new Decimal(msg.k.h),
                        low: new Decimal(msg.k.l),
                        close: new Decimal(msg.k.c),
                        volume: new Decimal(msg.k.v),
                    };
                    this.sub.onCandle(candle);
                }
                catch (err) {
                    // Malformed message: surface but do not kill the connection.
                    this.sub.onError?.(err instanceof Error ? err : new Error(String(err)));
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
            ws.on('error', (err) => {
                this.sub.onError?.(err);
                // The 'close' event will fire next and trigger reconnect logic.
                if (this.status !== 'open') {
                    reject(err);
                }
            });
        });
    }
    scheduleReconnect() {
        if (this.closed)
            return;
        if (this.reconnectAttempts >= this.maxReconnectAttempts) {
            this.setStatus('error');
            this.sub.onError?.(new Error(`Max reconnect attempts (${this.maxReconnectAttempts}) reached`));
            return;
        }
        this.setStatus('reconnecting');
        const backoff = Math.min(this.reconnectBackoffMs * Math.pow(2, this.reconnectAttempts), this.maxReconnectBackoffMs);
        this.reconnectAttempts++;
        this.reconnectTimer = setTimeout(() => {
            this.connect().catch((err) => {
                // connect() rejects on first-connection failure; the 'close' handler
                // will retry. Swallow to avoid unhandled rejection.
                this.sub.onError?.(err instanceof Error ? err : new Error(String(err)));
            });
        }, backoff);
    }
    setStatus(status) {
        this.status = status;
        this.sub.onStatus?.(status);
    }
    /** Stop the stream and release the socket. Idempotent. */
    async unsubscribe() {
        this.closed = true;
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }
        if (this.ws) {
            const ws = this.ws;
            this.ws = null;
            await new Promise((resolve) => {
                ws.once('close', () => resolve());
                try {
                    ws.close();
                }
                catch {
                    resolve();
                }
            });
        }
        this.setStatus('closed');
    }
    get currentStatus() {
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
export async function subscribeBinanceKlines(sub, config) {
    const stream = new BinanceKlineStream(sub, config);
    await stream.connect();
    return {
        unsubscribe: () => stream.unsubscribe(),
        get status() {
            return stream.currentStatus;
        },
    };
}
//# sourceMappingURL=ws.js.map