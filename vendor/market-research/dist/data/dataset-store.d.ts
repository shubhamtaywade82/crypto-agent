import type { Candle, Timeframe } from '@nemesis-oss/market-events';
import type { StoredDatasetMetadata } from './types.js';
/**
 * Saves immutable normalized candles and metadata to a JSON file.
 */
export declare function saveDataset(storageDir: string, symbol: string, timeframe: Timeframe, candles: readonly Candle[]): Promise<string>;
/**
 * Loads a cached immutable dataset from disk into Decimal Candle instances.
 */
export declare function loadDataset(filePath: string): Promise<{
    metadata: StoredDatasetMetadata;
    candles: Candle[];
}>;
//# sourceMappingURL=dataset-store.d.ts.map