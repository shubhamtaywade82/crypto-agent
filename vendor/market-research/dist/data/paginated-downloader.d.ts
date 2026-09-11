import type { Candle } from '@nemesis-oss/market-events';
import type { HistoricalFetcherOptions, KlineDataSource } from './types.js';
/**
 * Downloads historical klines in paginated windows to avoid rate limits or batch bounds.
 */
export declare function downloadPaginatedKlines(source: KlineDataSource, options: HistoricalFetcherOptions): Promise<Candle[]>;
//# sourceMappingURL=paginated-downloader.d.ts.map