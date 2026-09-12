import { BINANCE_REST_FUTURES, BINANCE_REST_SPOT, BINANCE_WS_FUTURES, BinanceRestAdapter, } from './rest.js';
import { subscribeBinanceKlines } from './ws.js';
/**
 * Binance adapter: implements the full {@link ExchangeAdapter} surface
 * using spot REST for klines and USDⓈ-M futures REST for funding/OI/mark.
 *
 * Live klines come from the futures WebSocket stream, which sends a
 * kline message on every update but only closed klines are forwarded to
 * the consumer.
 */
export class BinanceAdapter {
    exchange = 'binance';
    restBaseUrl;
    wsBaseUrl;
    rest;
    wsConfig;
    constructor(config = {}) {
        const spotRest = config.spotRestBaseUrl ?? BINANCE_REST_SPOT;
        this.restBaseUrl = spotRest;
        this.wsBaseUrl = config.wsBaseUrl ?? BINANCE_WS_FUTURES;
        this.rest = new BinanceRestAdapter({
            spotRestBaseUrl: spotRest,
            futuresRestBaseUrl: config.futuresRestBaseUrl ?? BINANCE_REST_FUTURES,
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
//# sourceMappingURL=adapter.js.map