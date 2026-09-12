import type { Candle } from '@nemesis-oss/market-events';
import type { ExchangeAdapter, ExchangeId, FetchKlinesOptions, FundingRateSnapshot, LiveKlineSubscription, MarkPriceSnapshot, OpenInterestSnapshot, StreamSubscription } from '../types.js';
import type { BinanceAdapterConfig } from './rest.js';
import { type BinanceWsConfig } from './ws.js';
/**
 * Binance adapter: implements the full {@link ExchangeAdapter} surface
 * using spot REST for klines and USDⓈ-M futures REST for funding/OI/mark.
 *
 * Live klines come from the futures WebSocket stream, which sends a
 * kline message on every update but only closed klines are forwarded to
 * the consumer.
 */
export declare class BinanceAdapter implements ExchangeAdapter {
    readonly exchange: ExchangeId;
    readonly restBaseUrl: string;
    readonly wsBaseUrl: string;
    private readonly rest;
    private readonly wsConfig;
    constructor(config?: BinanceAdapterConfig & BinanceWsConfig);
    fetchKlines(options: FetchKlinesOptions): Promise<readonly Candle[]>;
    subscribeKlines(sub: LiveKlineSubscription): Promise<StreamSubscription>;
    fetchFundingRate(symbol: string): Promise<FundingRateSnapshot | null>;
    fetchOpenInterest(symbol: string): Promise<OpenInterestSnapshot | null>;
    fetchMarkPrice(symbol: string): Promise<MarkPriceSnapshot | null>;
}
/** Factory: create a Binance adapter with sensible defaults. */
export declare function createBinanceAdapter(config?: BinanceAdapterConfig & BinanceWsConfig): BinanceAdapter;
//# sourceMappingURL=adapter.d.ts.map