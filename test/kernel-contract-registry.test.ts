import { describe, it, expect, vi } from 'vitest';
import { ContractRegistry, isSaneSpec } from '../src/infrastructure/coindcx/contract-registry.js';
import { FALLBACK_SPEC } from '../src/domain/futures/contract-spec.js';
import type { IExecutionBroker } from '../src/infrastructure/broker/broker.js';

const realSpec = {
  ...FALLBACK_SPEC('SOL'),
  pair: 'B-SOL_USDT',
  lotSize: 0.1,
  minQuantity: 0.5,
  minNotional: 50,
  maxLeverage: 10,
};

const okBroker = (impl: Partial<IExecutionBroker>): IExecutionBroker => impl as IExecutionBroker;

describe('ContractRegistry — real venue instrument specs for sizing', () => {
  it('serves the real venue spec and caches it', async () => {
    const getInstrument = vi.fn().mockResolvedValue(realSpec);
    const registry = new ContractRegistry();
    const broker = okBroker({ getInstrument });

    const first = await registry.lookup(broker, 'B-SOL_USDT');
    expect(first.kind).toBe('AVAILABLE');
    if (first.kind === 'AVAILABLE') {
      expect(first.spec.minQuantity).toBe(0.5);
      expect(first.spec.lotSize).toBe(0.1);
    }
    // Second call within TTL: served from cache, no extra venue call.
    await registry.lookup(broker, 'B-SOL_USDT');
    expect(getInstrument).toHaveBeenCalledTimes(1);
  });

  it('classifies a transport failure as LOOKUP_FAILED, never a fallback spec', async () => {
    const registry = new ContractRegistry();
    const broker = okBroker({
      getInstrument: vi.fn().mockRejectedValue(new Error('auth failed')),
    });
    const result = await registry.lookup(broker, 'B-SOL_USDT');
    expect(result.kind).toBe('LOOKUP_FAILED');
    if (result.kind === 'LOOKUP_FAILED') {
      expect(result.reason).toContain('auth failed');
    }
  });

  it('require() throws a degraded-trading error on lookup failure', async () => {
    const registry = new ContractRegistry();
    const broker = okBroker({
      getInstrument: vi.fn().mockRejectedValue(new Error('rate limited')),
    });
    await expect(registry.require(broker, 'B-SOL_USDT'))
      .rejects.toThrow(/unavailable \(trading degraded\).*rate limited/);
  });

  it('classifies venue-answered missing instruments as UNKNOWN_INSTRUMENT', async () => {
    const registry = new ContractRegistry();
    const broker = okBroker({ getInstrument: vi.fn().mockResolvedValue(undefined) });
    const result = await registry.lookup(broker, 'B-FAKE_USDT');
    expect(result.kind).toBe('UNKNOWN_INSTRUMENT');
  });

  it('rejects structurally corrupt specs instead of sizing with them', async () => {
    const registry = new ContractRegistry();
    const broker = okBroker({
      getInstrument: vi.fn().mockResolvedValue({ ...realSpec, lotSize: 0 }),
    });
    const result = await registry.lookup(broker, 'B-SOL_USDT');
    expect(result.kind).toBe('LOOKUP_FAILED');
  });

  it('serves a known-good stale spec when the venue goes down, within bounds', async () => {
    vi.useFakeTimers();
    try {
      const getInstrument = vi.fn()
        .mockResolvedValueOnce(realSpec)
        .mockRejectedValue(new Error('venue down'));
      const registry = new ContractRegistry({ ttlMs: 1_000, maxStaleMs: 60_000 });
      const broker = okBroker({ getInstrument });

      const fresh = await registry.lookup(broker, 'B-SOL_USDT');
      expect(fresh.kind).toBe('AVAILABLE');

      // Advance past TTL but within maxStaleMs: venue now down.
      vi.advanceTimersByTime(2_000);
      const stale = await registry.lookup(broker, 'B-SOL_USDT');
      expect(stale.kind).toBe('AVAILABLE');
      if (stale.kind === 'AVAILABLE') {
        expect(stale.ageMs).toBeGreaterThanOrEqual(2_000);
      }

      // Advance beyond maxStaleMs: degrade instead of flying blind.
      vi.advanceTimersByTime(70_000);
      const dead = await registry.lookup(broker, 'B-SOL_USDT');
      expect(dead.kind).toBe('LOOKUP_FAILED');
    } finally {
      vi.useRealTimers();
    }
  });

  it('isSaneSpec gates malformed constraints', () => {
    expect(isSaneSpec(FALLBACK_SPEC('SOL'))).toBe(true);
    expect(isSaneSpec({ ...FALLBACK_SPEC('SOL'), minQuantity: -1 })).toBe(false);
    expect(isSaneSpec({ ...FALLBACK_SPEC('SOL'), maxLeverage: 0 })).toBe(false);
    expect(isSaneSpec({ ...FALLBACK_SPEC('SOL'), maxQuantity: 0.01, minQuantity: 1 })).toBe(false);
  });
});
