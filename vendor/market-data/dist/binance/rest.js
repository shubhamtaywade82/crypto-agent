import { Decimal } from 'decimal.js';
import { httpGetJson, HttpTransientError } from '../http.js';
/**
 * Binance Futures interval mapping.
 * Spot uses the same strings for most timeframes; this map works for both.
 */
export const BINANCE_INTERVAL_MAP = {
    '1m': '1m',
    '3m': '3m',
    '5m': '5m',
    '15m': '15m',
    '30m': '30m',
    '1h': '1h',
    '2h': '2h',
    '4h': '4h',
    '6h': '6h',
    '8h': '8h',
    '12h': '12h',
    '1d': '1d',
    '1w': '1w',
    '1M': '1M',
};
/**
 * Binance REST base URLs. Both are publicly reachable; futures is needed
 * for funding/OI/mark-price endpoints.
 */
export const BINANCE_REST_SPOT = 'https://api.binance.com';
export const BINANCE_REST_FUTURES = 'https://fapi.binance.com';
export const BINANCE_WS_FUTURES = 'wss://fstream.binance.com';
/**
 * Binance REST adapter. Implements the historical klines, funding, OI, and
 * mark-price surface for both spot and USDⓈ-M futures.
 *
 * Klines are fetched from the spot endpoint by default; if `futuresRestBaseUrl`
 * is used as the kline source, set `useFuturesKlines: true` (not exposed
 * here — callers who need futures klines should construct the adapter with
 * `spotRestBaseUrl` pointed at the futures base URL).
 *
 * Rate-limit handling: pagination with batchLimit ≤ 1000 (spot) / 1500
 * (futures). HTTP 429 triggers backoff honoring `Retry-After`.
 */
export class BinanceRestAdapter {
    spotRest;
    futuresRest;
    timeoutMs;
    maxRetries;
    retryBackoffMs;
    constructor(config = {}) {
        this.spotRest = config.spotRestBaseUrl ?? BINANCE_REST_SPOT;
        this.futuresRest = config.futuresRestBaseUrl ?? BINANCE_REST_FUTURES;
        this.timeoutMs = config.requestTimeoutMs ?? 15_000;
        this.maxRetries = config.maxRetries ?? 3;
        this.retryBackoffMs = config.retryBackoffMs ?? 500;
    }
    /**
     * Fetch historical klines (closed candles only). Paginates automatically.
     * Returns candles sorted ascending by openTime, deduplicated.
     */
    async fetchKlines(options) {
        const interval = BINANCE_INTERVAL_MAP[options.timeframe];
        const batchLimit = Math.min(options.batchLimit ?? 1000, 1000);
        const all = [];
        const seen = new Set();
        let currentStart = options.startTime;
        while (currentStart < options.endTime) {
            const url = new URL(`${this.spotRest}/api/v3/klines`);
            url.searchParams.set('symbol', options.symbol);
            url.searchParams.set('interval', interval);
            url.searchParams.set('startTime', String(currentStart));
            url.searchParams.set('endTime', String(options.endTime));
            url.searchParams.set('limit', String(batchLimit));
            const batch = await httpGetJson({
                url: url.toString(),
                timeoutMs: this.timeoutMs,
                maxRetries: this.maxRetries,
                retryBackoffMs: this.retryBackoffMs,
                signal: options.signal,
            });
            if (batch.length === 0)
                break;
            for (const raw of batch) {
                const ts = raw[0];
                if (seen.has(ts))
                    continue;
                seen.add(ts);
                all.push({
                    timestamp: ts,
                    open: new Decimal(raw[1]),
                    high: new Decimal(raw[2]),
                    low: new Decimal(raw[3]),
                    close: new Decimal(raw[4]),
                    volume: new Decimal(raw[5]),
                });
            }
            const lastCloseTime = batch[batch.length - 1][6];
            if (lastCloseTime <= currentStart) {
                currentStart += 1;
            }
            else {
                currentStart = lastCloseTime + 1;
            }
            if (batch.length < batchLimit)
                break;
        }
        all.sort((a, b) => a.timestamp - b.timestamp);
        return all;
    }
    /** Fetch the most recent funding rate from USDⓈ-M futures. */
    async fetchFundingRate(symbol) {
        try {
            const url = new URL(`${this.futuresRest}/fapi/v1/premiumIndex`);
            url.searchParams.set('symbol', symbol);
            const data = await httpGetJson({
                url: url.toString(),
                timeoutMs: this.timeoutMs,
                maxRetries: this.maxRetries,
                retryBackoffMs: this.retryBackoffMs,
            });
            return {
                symbol: data.symbol,
                fundingRate: Number(data.lastFundingRate ?? '0'),
                markPrice: Number(data.markPrice ?? '0'),
                fundingTime: data.time ?? Date.now(),
            };
        }
        catch (err) {
            if (err instanceof HttpTransientError && err.status === 400) {
                // Symbol not found on futures — likely a spot-only pair.
                return null;
            }
            throw err;
        }
    }
    /** Fetch current open interest (USDⓈ-M futures only). */
    async fetchOpenInterest(symbol) {
        try {
            const url = new URL(`${this.futuresRest}/fapi/v1/openInterest`);
            url.searchParams.set('symbol', symbol);
            const data = await httpGetJson({
                url: url.toString(),
                timeoutMs: this.timeoutMs,
                maxRetries: this.maxRetries,
                retryBackoffMs: this.retryBackoffMs,
            });
            return {
                symbol,
                openInterest: Number(data.openInterest),
                timestamp: data.time,
            };
        }
        catch (err) {
            if (err instanceof HttpTransientError && err.status === 400) {
                return null;
            }
            throw err;
        }
    }
    /** Fetch current mark price + index price from USDⓈ-M futures. */
    async fetchMarkPrice(symbol) {
        try {
            const url = new URL(`${this.futuresRest}/fapi/v1/premiumIndex`);
            url.searchParams.set('symbol', symbol);
            const data = await httpGetJson({
                url: url.toString(),
                timeoutMs: this.timeoutMs,
                maxRetries: this.maxRetries,
                retryBackoffMs: this.retryBackoffMs,
            });
            return {
                symbol: data.symbol,
                markPrice: Number(data.markPrice ?? '0'),
                indexPrice: Number(data.indexPrice ?? '0'),
                fundingRate: Number(data.lastFundingRate ?? '0'),
                timestamp: data.time ?? Date.now(),
            };
        }
        catch (err) {
            if (err instanceof HttpTransientError && err.status === 400) {
                return null;
            }
            throw err;
        }
    }
}
//# sourceMappingURL=rest.js.map