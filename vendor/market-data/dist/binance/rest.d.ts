import type { Candle, Timeframe } from '@nemesis-oss/market-events';
import type { FetchKlinesOptions, FundingRateSnapshot, MarkPriceSnapshot, OpenInterestSnapshot } from '../types.js';
/**
 * Binance Futures interval mapping.
 * Spot uses the same strings for most timeframes; this map works for both.
 */
export declare const BINANCE_INTERVAL_MAP: Readonly<Record<Timeframe, string>>;
/**
 * Binance REST base URLs. Both are publicly reachable; futures is needed
 * for funding/OI/mark-price endpoints.
 */
export declare const BINANCE_REST_SPOT = "https://api.binance.com";
export declare const BINANCE_REST_FUTURES = "https://fapi.binance.com";
export declare const BINANCE_WS_FUTURES = "wss://fstream.binance.com";
export interface BinanceAdapterConfig {
    /** REST spot base. Default {@link BINANCE_REST_SPOT}. */
    readonly spotRestBaseUrl?: string | undefined;
    /** REST futures base. Default {@link BINANCE_REST_FUTURES}. */
    readonly futuresRestBaseUrl?: string | undefined;
    /** Per-request timeout. Default 15_000 ms. */
    readonly requestTimeoutMs?: number | undefined;
    /** Max retries. Default 3. */
    readonly maxRetries?: number | undefined;
    /** Backoff base. Default 500 ms. */
    readonly retryBackoffMs?: number | undefined;
}
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
export declare class BinanceRestAdapter {
    readonly spotRest: string;
    readonly futuresRest: string;
    private readonly timeoutMs;
    private readonly maxRetries;
    private readonly retryBackoffMs;
    constructor(config?: BinanceAdapterConfig);
    /**
     * Fetch historical klines (closed candles only). Paginates automatically.
     * Returns candles sorted ascending by openTime, deduplicated.
     */
    fetchKlines(options: FetchKlinesOptions): Promise<readonly Candle[]>;
    /** Fetch the most recent funding rate from USDⓈ-M futures. */
    fetchFundingRate(symbol: string): Promise<FundingRateSnapshot | null>;
    /** Fetch current open interest (USDⓈ-M futures only). */
    fetchOpenInterest(symbol: string): Promise<OpenInterestSnapshot | null>;
    /** Fetch current mark price + index price from USDⓈ-M futures. */
    fetchMarkPrice(symbol: string): Promise<MarkPriceSnapshot | null>;
}
//# sourceMappingURL=rest.d.ts.map