import type { Candle, Timeframe } from '@nemesis-oss/market-events';

export interface HistoricalFetcherOptions {
  readonly symbol: string;
  readonly timeframe: Timeframe;
  readonly startTime: number;
  readonly endTime: number;
  readonly batchLimit?: number;
}

export interface KlineDataSource {
  fetchKlines(
    symbol: string,
    interval: string,
    options: { startTime: number; endTime: number; limit: number }
  ): Promise<readonly RawKlineRecord[]>;
}

export interface RawKlineRecord {
  readonly openTime: number;
  readonly open: number | string;
  readonly high: number | string;
  readonly low: number | string;
  readonly close: number | string;
  readonly volume: number | string;
  readonly closeTime: number;
}

export interface StoredDatasetMetadata {
  readonly symbol: string;
  readonly timeframe: Timeframe;
  readonly startTime: number;
  readonly endTime: number;
  readonly count: number;
  readonly exportedAt: number;
}
