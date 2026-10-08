import { describe, it, expect, vi } from 'vitest';
import { ContractRegistry, isSaneSpec } from '../src/infrastructure/coindcx/contract-registry.js';
import {
  FALLBACK_SPEC, alignProposalForVenue, alignProposalToTick, alignToTick,
  type ContractSpec,
} from '../src/domain/futures/contract-spec.js';
import { computeRr, type TradeProposal } from '../src/domain/orders/trade-proposal.js';
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

const proposal = (over: Partial<TradeProposal> = {}): TradeProposal => ({
  symbol: 'SOLUSDT', direction: 'LONG', entry: 100, stopLoss: 95, takeProfit: 115,
  orderType: 'MARKET', leverage: 5, setupType: 'TEST', confidence: 0.8,
  thesis: 'test thesis', invalidation: 'test invalidation', source: 'MANUAL', ...over,
});

const solSpec = async (): Promise<ContractSpec> => FALLBACK_SPEC('SOL');

describe('venue tick alignment — the rounding direction never flatters the trade', () => {
  it('floors LONG levels and ceils SHORT levels onto the tick', () => {
    expect(alignToTick(99.237, 0.01, 'LONG')).toBe(99.23);
    expect(alignToTick(101.237, 0.01, 'SHORT')).toBe(101.24);
    expect(alignToTick(100.5, 0.01, 'LONG')).toBe(100.5);
  });

  it('refuses a non-positive tick and a non-finite price', () => {
    expect(() => alignToTick(100, 0, 'LONG')).toThrow(/non-positive tick/);
    expect(() => alignToTick(Number.NaN, 0.01, 'SHORT')).toThrow(/non-finite/);
  });

  it('moves a LONG stop away from entry and a LONG target toward entry', () => {
    const aligned = alignProposalToTick(
      proposal({ entry: 100.5, stopLoss: 99.237, takeProfit: 103.811 }), FALLBACK_SPEC('SOL')
    );
    expect(aligned.stopLoss).toBe(99.23);
    expect(aligned.takeProfit).toBe(103.81);
  });

  it('mirrors the rule for SHORT positions', () => {
    const aligned = alignProposalToTick(
      proposal({ direction: 'SHORT', entry: 100.5, stopLoss: 101.237, takeProfit: 97.811 }),
      FALLBACK_SPEC('SOL')
    );
    expect(aligned.stopLoss).toBe(101.24);
    expect(aligned.takeProfit).toBe(97.82);
  });

  it('restores the R:R floor that alignment costs a target extended to exactly 2R', async () => {
    const raw = proposal({
      entry: 362.8855222443444, stopLoss: 328.1454125853616, takeProfit: 432.3657415623099,
    });
    expect(computeRr(raw).rr).toBeCloseTo(2, 9);
    const aligned = await alignProposalForVenue(raw, solSpec, 2);
    expect(aligned.stopLoss).toBe(328.14);
    expect(computeRr(aligned).rr).toBeGreaterThanOrEqual(2);
    expect(aligned.takeProfit).toBeGreaterThanOrEqual(raw.takeProfit);
    expect(alignToTick(aligned.takeProfit, 0.01, 'LONG')).toBe(aligned.takeProfit);
  });

  it('does not repair a proposal that missed the R:R floor on its own prices', async () => {
    const raw = proposal({ entry: 100, stopLoss: 95, takeProfit: 107 });
    const aligned = await alignProposalForVenue(raw, solSpec, 2.5);
    expect(computeRr(aligned).rr).toBeLessThan(2.5);
  });

  it('returns the proposal unchanged when the spec lookup fails', async () => {
    const raw = proposal({ stopLoss: 95.004 });
    const out = await alignProposalForVenue(raw, async () => {
      throw new Error('venue down');
    }, 2);
    expect(out).toBe(raw);
  });
});
