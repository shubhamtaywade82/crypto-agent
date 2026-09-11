import type { Candle } from '@nemesis-oss/market-events';
import { normalizeCandle, sanitizeCandles } from './candle-normalizer.js';
import type { HistoricalFetcherOptions, KlineDataSource } from './types.js';

/**
 * Downloads historical klines in paginated windows to avoid rate limits or batch bounds.
 */
export async function downloadPaginatedKlines(
  source: KlineDataSource,
  options: HistoricalFetcherOptions
): Promise<Candle[]> {
  const { symbol, timeframe, startTime, endTime } = options;
  const batchLimit = options.batchLimit ?? 1000;
  const allCandles: Candle[] = [];

  let currentStart = startTime;

  while (currentStart < endTime) {
    const rawBatch = await source.fetchKlines(symbol, timeframe, {
      startTime: currentStart,
      endTime,
      limit: batchLimit
    });

    if (rawBatch.length === 0) {
      break;
    }

    for (const raw of rawBatch) {
      allCandles.push(normalizeCandle(raw));
    }

    const last = rawBatch[rawBatch.length - 1]!;
    if (last.closeTime <= currentStart) {
      // Prevent infinite loop if timestamps do not advance
      currentStart += 1;
    } else {
      currentStart = last.closeTime + 1;
    }

    if (rawBatch.length < batchLimit) {
      break;
    }
  }

  return sanitizeCandles(allCandles);
}
