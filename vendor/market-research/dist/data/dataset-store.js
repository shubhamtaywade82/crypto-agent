import { promises as fs } from 'node:fs';
import path from 'node:path';
import { Decimal } from 'decimal.js';
/**
 * Saves immutable normalized candles and metadata to a JSON file.
 */
export async function saveDataset(storageDir, symbol, timeframe, candles) {
    await fs.mkdir(storageDir, { recursive: true });
    const filename = `${symbol.toUpperCase()}-${timeframe}.json`;
    const filePath = path.join(storageDir, filename);
    const payload = {
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
export async function loadDataset(filePath) {
    const raw = await fs.readFile(filePath, 'utf-8');
    const payload = JSON.parse(raw);
    const candles = payload.candles.map(c => ({
        timestamp: c.timestamp,
        open: new Decimal(c.open),
        high: new Decimal(c.high),
        low: new Decimal(c.low),
        close: new Decimal(c.close),
        volume: new Decimal(c.volume)
    }));
    return { metadata: payload.metadata, candles };
}
//# sourceMappingURL=dataset-store.js.map