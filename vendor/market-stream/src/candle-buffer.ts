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
export class CandleBuffer {
  private readonly capacity: number;
  private readonly buffer: Candle[];
  private head = 0; // next write position
  private count = 0; // current element count
  private readonly seen = new Set<number>(); // dedup by timestamp

  constructor(capacity = 200) {
    if (capacity < 3) {
      throw new Error('CandleBuffer capacity must be >= 3 (event detectors need lookback)');
    }
    this.capacity = capacity;
    this.buffer = new Array<Candle>(capacity);
  }

  /**
   * Push a candle into the buffer. Returns true if the candle was new
   * (timestamp not seen before), false if it was a duplicate.
   *
   * If the buffer is full, the oldest candle is overwritten.
   */
  push(candle: Candle): boolean {
    if (this.seen.has(candle.timestamp)) {
      return false; // dedup: reconnect replay or exchange duplicate
    }
    this.seen.add(candle.timestamp);

    // If we're about to overwrite an existing candle, remove its timestamp
    // from the dedup set so it can be re-added if the stream replays it.
    if (this.count >= this.capacity) {
      const evicted = this.buffer[this.head]!;
      this.seen.delete(evicted.timestamp);
    } else {
      this.count++;
    }

    this.buffer[this.head] = candle;
    this.head = (this.head + 1) % this.capacity;
    return true;
  }

  /** Current number of candles in the buffer. */
  get length(): number {
    return this.count;
  }

  /** Maximum capacity. */
  get maxCapacity(): number {
    return this.capacity;
  }

  /**
   * Get candles as a contiguous array, oldest-first. Allocates a new array
   * on every call — callers should cache the result if they need to iterate
   * multiple times.
   */
  toArray(): Candle[] {
    const result: Candle[] = [];
    if (this.count < this.capacity) {
      // Buffer not yet full: elements are at indices 0..count-1
      for (let i = 0; i < this.count; i++) {
        result.push(this.buffer[i]!);
      }
    } else {
      // Buffer full: elements are at head, head+1, ..., head-1 (wrapping)
      for (let i = 0; i < this.capacity; i++) {
        const idx = (this.head + i) % this.capacity;
        result.push(this.buffer[idx]!);
      }
    }
    return result;
  }

  /** Get the most recent candle, or null if the buffer is empty. */
  latest(): Candle | null {
    if (this.count === 0) return null;
    const latestIdx = (this.head - 1 + this.capacity) % this.capacity;
    return this.buffer[latestIdx]!;
  }

  /** Clear the buffer. */
  clear(): void {
    this.head = 0;
    this.count = 0;
    this.seen.clear();
  }
}
