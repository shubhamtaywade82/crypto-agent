import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { BinanceRateLimiter } from '../src/guardians/rate-limiter.js';

describe('BinanceRateLimiter', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('tracks endpoint weights within rolling window', async () => {
    const limiter = new BinanceRateLimiter();
    await limiter.requestPermission('ticker24hr');
    expect(limiter.getCurrentWeight()).toBe(2);

    await limiter.requestPermission('depth');
    expect(limiter.getCurrentWeight()).toBe(12);
  });

  it('expires weights older than 60 seconds', async () => {
    const limiter = new BinanceRateLimiter();
    await limiter.requestPermission('ticker24hr');
    expect(limiter.getCurrentWeight()).toBe(2);

    vi.advanceTimersByTime(61_000);
    expect(limiter.getCurrentWeight()).toBe(0);
  });

  it('resets history upon explicit reset call', async () => {
    const limiter = new BinanceRateLimiter();
    await limiter.requestPermission('depth');
    expect(limiter.getCurrentWeight()).toBe(10);

    limiter.reset();
    expect(limiter.getCurrentWeight()).toBe(0);
  });

  it('pauses when projected weight reaches safe threshold', async () => {
    const limiter = new BinanceRateLimiter();
    // Pre-fill history to near 1000 threshold (100 depth calls = 1000 weight)
    for (let i = 0; i < 99; i++) {
      await limiter.requestPermission('depth');
    }
    expect(limiter.getCurrentWeight()).toBe(990);

    const setTimeoutSpy = vi.spyOn(global, 'setTimeout');
    const pendingPromise = limiter.requestPermission('depth');
    // Fast-forward past sleep
    await vi.advanceTimersByTimeAsync(65_000);
    await pendingPromise;

    expect(setTimeoutSpy).toHaveBeenCalled();
  });
});
