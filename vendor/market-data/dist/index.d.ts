export * from './types.js';
export * from './http.js';
export { BINANCE_INTERVAL_MAP, BINANCE_REST_FUTURES, BINANCE_REST_SPOT, BINANCE_WS_FUTURES, BinanceRestAdapter, type BinanceAdapterConfig, } from './binance/rest.js';
export { BinanceKlineStream, subscribeBinanceKlines, type BinanceWsConfig } from './binance/ws.js';
export { BinanceAdapter, createBinanceAdapter } from './binance/adapter.js';
export { BYBIT_INTERVAL_MAP, BYBIT_REST_V5, BYBIT_WS_PUBLIC, BybitRestAdapter, createBybitRestAdapter, type BybitAdapterConfig, } from './bybit/rest.js';
import type { BinanceAdapterConfig } from './binance/rest.js';
import type { BinanceWsConfig } from './binance/ws.js';
import type { BybitAdapterConfig } from './bybit/rest.js';
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
export declare function createExchangeAdapter(exchange: 'binance' | 'bybit', config?: BinanceAdapterConfig & BinanceWsConfig & BybitAdapterConfig): import('./types.js').ExchangeAdapter;
//# sourceMappingURL=index.d.ts.map