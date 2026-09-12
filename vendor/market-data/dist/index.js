export * from './types.js';
export * from './http.js';
export { BINANCE_INTERVAL_MAP, BINANCE_REST_FUTURES, BINANCE_REST_SPOT, BINANCE_WS_FUTURES, BinanceRestAdapter, } from './binance/rest.js';
export { BinanceKlineStream, subscribeBinanceKlines } from './binance/ws.js';
export { BinanceAdapter, createBinanceAdapter } from './binance/adapter.js';
export { BYBIT_INTERVAL_MAP, BYBIT_REST_V5, BYBIT_WS_PUBLIC, BybitRestAdapter, createBybitRestAdapter, } from './bybit/rest.js';
import { createBinanceAdapter } from './binance/adapter.js';
import { createBybitRestAdapter, BYBIT_WS_PUBLIC } from './bybit/rest.js';
/**
 * Factory: select an exchange adapter by id. Throws on unknown exchanges.
 *
 * @example
 * ```ts
 * import { createExchangeAdapter } from '@nemesis-oss/market-data';
 *
 * const binance = createExchangeAdapter('binance');
 * const candles = await binance.fetchKlines({
 *   symbol: 'BTCUSDT',
 *   timeframe: '15m',
 *   startTime: Date.now() - 24 * 60 * 60 * 1000,
 *   endTime: Date.now(),
 * });
 * ```
 */
export function createExchangeAdapter(exchange, config) {
    switch (exchange) {
        case 'binance':
            return createBinanceAdapter(config);
        case 'bybit': {
            // Bybit adapter is REST-only for now (WS pending); wrap into the
            // ExchangeAdapter contract with a subscribeKlines that throws.
            const rest = createBybitRestAdapter(config);
            return {
                exchange: 'bybit',
                restBaseUrl: rest.restBaseUrl,
                wsBaseUrl: BYBIT_WS_PUBLIC,
                fetchKlines: (o) => rest.fetchKlines(o),
                fetchFundingRate: (s) => rest.fetchFundingRate(s),
                fetchOpenInterest: (s) => rest.fetchOpenInterest(s),
                fetchMarkPrice: (s) => rest.fetchMarkPrice(s),
                subscribeKlines: async () => {
                    throw new Error('Bybit WebSocket adapter not yet implemented. Use REST fetchKlines for now.');
                },
            };
        }
        default: {
            const _exhaustive = exchange;
            throw new Error(`Unknown exchange: ${String(_exhaustive)}`);
        }
    }
}
//# sourceMappingURL=index.js.map