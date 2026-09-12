import type { Candle } from '@nemesis-oss/market-events';
import type { ExchangeAdapter, ExchangeId, FetchKlinesOptions, FundingRateSnapshot, LiveKlineSubscription, MarkPriceSnapshot, OpenInterestSnapshot, StreamSubscription } from '../types.js';
import type { BinanceAdapterConfig, BinanceKlineMarket } from './rest.js';
import { type BinanceWsConfig } from './ws.js';
/**
 * Binance adapter: implements the full {@link ExchangeAdapter} surface.
 * Default historical klines are **spot**; live closed candles use USDⓈ-M futures WS.
 * For perp backtests aligned with WS, use {@link createBinanceFuturesAdapter}.
 */
export declare class BinanceAdapter implements ExchangeAdapter {
    readonly exchange: ExchangeId;
    readonly restBaseUrl: string;
    readonly wsBaseUrl: string;
    readonly klineMarket: BinanceKlineMarket;
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
/** USDⓈ-M futures REST klines + futures WS + funding/OI/mark (perp research default). */
export declare function createBinanceFuturesAdapter(config?: BinanceAdapterConfig & BinanceWsConfig): BinanceAdapter;
//# sourceMappingURL=adapter.d.ts.map