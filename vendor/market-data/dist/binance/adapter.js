import { BINANCE_REST_FUTURES, BINANCE_REST_SPOT, BINANCE_WS_FUTURES, BinanceRestAdapter, } from './rest.js';
import { subscribeBinanceKlines } from './ws.js';
/**
 * Binance adapter: implements the full {@link ExchangeAdapter} surface.
 * Default historical klines are **spot**; live closed candles use USDⓈ-M futures WS.
 * For perp backtests aligned with WS, use {@link createBinanceFuturesAdapter}.
 */
export class BinanceAdapter {
    exchange = 'binance';
    restBaseUrl;
    wsBaseUrl;
    klineMarket;
    rest;
    wsConfig;
    constructor(config = {}) {
        const klineMarket = config.klineMarket ?? 'spot';
        this.klineMarket = klineMarket;
        const spotRest = config.spotRestBaseUrl ?? BINANCE_REST_SPOT;
        this.restBaseUrl = klineMarket === 'usdm_futures'
            ? (config.futuresRestBaseUrl ?? BINANCE_REST_FUTURES)
            : spotRest;
        this.wsBaseUrl = config.wsBaseUrl ?? BINANCE_WS_FUTURES;
        this.rest = new BinanceRestAdapter({
            spotRestBaseUrl: spotRest,
            futuresRestBaseUrl: config.futuresRestBaseUrl ?? BINANCE_REST_FUTURES,
            klineMarket,
            requestTimeoutMs: config.requestTimeoutMs,
            maxRetries: config.maxRetries,
            retryBackoffMs: config.retryBackoffMs,
        });
        this.wsConfig = {
            wsBaseUrl: this.wsBaseUrl,
            reconnectBackoffMs: config.reconnectBackoffMs,
            maxReconnectBackoffMs: config.maxReconnectBackoffMs,
            maxReconnectAttempts: config.maxReconnectAttempts,
            pingIntervalMs: config.pingIntervalMs,
        };
    }
    fetchKlines(options) {
        return this.rest.fetchKlines(options);
    }
    subscribeKlines(sub) {
        return subscribeBinanceKlines(sub, this.wsConfig);
    }
    fetchFundingRate(symbol) {
        return this.rest.fetchFundingRate(symbol);
    }
    fetchOpenInterest(symbol) {
        return this.rest.fetchOpenInterest(symbol);
    }
    fetchMarkPrice(symbol) {
        return this.rest.fetchMarkPrice(symbol);
    }
}
/** Factory: create a Binance adapter with sensible defaults. */
export function createBinanceAdapter(config) {
    return new BinanceAdapter(config);
}
/** USDⓈ-M futures REST klines + futures WS + funding/OI/mark (perp research default). */
export function createBinanceFuturesAdapter(config) {
    return new BinanceAdapter({ ...config, klineMarket: 'usdm_futures' });
}
//# sourceMappingURL=adapter.js.map