import { promises as fs } from 'node:fs';
import path from 'node:path';
import { Decimal } from 'decimal.js';
import type { Candle, Timeframe } from '@nemesis-oss/market-events';
import type { StoredDatasetMetadata } from './types.js';

interface SerializedCandle {
  timestamp: number;
  open: string;
  high: string;
  low: string;
  close: string;
  volume: string;
}

interface DatasetFilePayload {
  metadata: StoredDatasetMetadata;
  candles: SerializedCandle[];
}

/**
 * Saves immutable normalized candles and metadata to a JSON file.
 */
export async function saveDataset(
  storageDir: string,
  symbol: string,
  timeframe: Timeframe,
  candles: readonly Candle[],
  cacheLabel?: string
): Promise<string> {
  await fs.mkdir(storageDir, { recursive: true });
  const filename = cacheLabel
    ? `${symbol.toUpperCase()}-${timeframe}-${cacheLabel}.json`
    : `${symbol.toUpperCase()}-${timeframe}.json`;
  const filePath = path.join(storageDir, filename);

  const payload: DatasetFilePayload = {
    metadata: {
      symbol,
      timeframe,
      startTime: candles[0]?.timestamp ?? 0,
      endTime: candles[candles.length - 1]?.timestamp ?? 0,
      count: candles.length,
      exportedAt: Date.now()
    },
    candles: candles.map(c => ({
      timestamp: c.timestamp,
      open: c.open.toString(),
      high: c.high.toString(),
      low: c.low.toString(),
      close: c.close.toString(),
      volume: c.volume.toString()
    }))
  };

  await fs.writeFile(filePath, JSON.stringify(payload, null, 2), 'utf-8');
  return filePath;
}

/**
 * Loads a cached immutable dataset from disk into Decimal Candle instances.
 */
export async function loadDataset(filePath: string): Promise<{ metadata: StoredDatasetMetadata; candles: Candle[] }> {
  const raw = await fs.readFile(filePath, 'utf-8');
  const payload = JSON.parse(raw) as DatasetFilePayload;

  const candles: Candle[] = payload.candles.map(c => ({
    timestamp: c.timestamp,
    open: new Decimal(c.open),
    high: new Decimal(c.high),
    low: new Decimal(c.low),
    close: new Decimal(c.close),
    volume: new Decimal(c.volume)
  }));

  return { metadata: payload.metadata, candles };
}
