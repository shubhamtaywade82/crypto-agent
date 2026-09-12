import type { Candle, Timeframe } from '@nemesis-oss/market-events';
import type { ExchangeId, FetchKlinesOptions, FundingRateSnapshot, MarkPriceSnapshot, OpenInterestSnapshot } from '../types.js';
export declare const BYBIT_REST_V5 = "https://api.bybit.com";
export declare const BYBIT_WS_PUBLIC = "wss://stream.bybit.com/v5/public/linear";
export declare const BYBIT_INTERVAL_MAP: Readonly<Record<Timeframe, string>>;
export interface BybitAdapterConfig {
    readonly restBaseUrl?: string;
    readonly requestTimeoutMs?: number;
    readonly maxRetries?: number;
    readonly retryBackoffMs?: number;
}
/**
 * Bybit V5 REST adapter. Implements historical klines, funding, OI, and
 * mark-price surface for linear (USDT-perp) instruments.
 *
 * Note: this is a thinner implementation than the Binance adapter — Bybit's
 * WebSocket requires a more involved topic-subscription protocol and is
 * intentionally deferred to a follow-up. REST klines cover the primary
 * research use case (historical dataset construction).
 */
export declare class BybitRestAdapter {
    readonly exchange: ExchangeId;
    readonly restBaseUrl: string;
    private readonly timeoutMs;
    private readonly maxRetries;
    private readonly retryBackoffMs;
    constructor(config?: BybitAdapterConfig);
    fetchKlines(options: FetchKlinesOptions): Promise<readonly Candle[]>;
    fetchFundingRate(symbol: string): Promise<FundingRateSnapshot | null>;
    fetchOpenInterest(symbol: string): Promise<OpenInterestSnapshot | null>;
    fetchMarkPrice(symbol: string): Promise<MarkPriceSnapshot | null>;
}
/** Factory: create a Bybit adapter. */
export declare function createBybitRestAdapter(config?: BybitAdapterConfig): BybitRestAdapter;
//# sourceMappingURL=rest.d.ts.map