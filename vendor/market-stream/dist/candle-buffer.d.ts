import type { Candle } from '@nemesis-oss/market-events';
/**
 * Rolling candle buffer with O(1) push, timestamp deduplication, and
 * bounded memory.
 *
 * Used by {@link StateTracker} to maintain a rolling window of recent
 * candles for regime/ATR computation and event detection. The buffer is
 * a ring: when full, the oldest candle is overwritten.
 *
 * Thread safety: single-threaded JS (no workers), so no locks needed.
 * Backpressure: if the buffer is full, the oldest candle is dropped
 * silently — this is the intended behavior for a rolling window.
 */
export declare class CandleBuffer {
    private readonly capacity;
    private readonly buffer;
    private head;
    private count;
    private readonly seen;
    constructor(capacity?: number);
    /**
     * Push a candle into the buffer. Returns true if the candle was new
     * (timestamp not seen before), false if it was a duplicate.
     *
     * If the buffer is full, the oldest candle is overwritten.
     */
    push(candle: Candle): boolean;
    /** Current number of candles in the buffer. */
    get length(): number;
    /** Maximum capacity. */
    get maxCapacity(): number;
    /**
     * Get candles as a contiguous array, oldest-first. Allocates a new array
     * on every call — callers should cache the result if they need to iterate
     * multiple times.
     */
    toArray(): Candle[];
    /** Get the most recent candle, or null if the buffer is empty. */
    latest(): Candle | null;
    /** Clear the buffer. */
    clear(): void;
}
//# sourceMappingURL=candle-buffer.d.ts.map