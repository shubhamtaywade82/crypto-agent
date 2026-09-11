import { Decimal } from 'decimal.js';
/**
 * Normalizes raw exchange records to canonical Candle instances with Decimal precision.
 */
export function normalizeCandle(raw) {
    return {
        timestamp: raw.openTime,
        open: new Decimal(raw.open),
        high: new Decimal(raw.high),
        low: new Decimal(raw.low),
        close: new Decimal(raw.close),
        volume: new Decimal(raw.volume)
    };
}
/**
 * Deduplicates and sorts candles chronologically by UTC timestamp.
 */
export function sanitizeCandles(candles) {
    const seen = new Set();
    const unique = [];
    for (const c of candles) {
        if (!seen.has(c.timestamp)) {
            seen.add(c.timestamp);
            unique.push(c);
        }
    }
    return unique.sort((a, b) => a.timestamp - b.timestamp);
}
//# sourceMappingURL=candle-normalizer.js.map