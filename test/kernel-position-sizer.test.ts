import { describe, it, expect } from 'vitest';
import { sizePosition } from '../src/engines/position-sizer.js';
import type { SizingInput } from '../src/engines/position-sizer.js';
import { DEFAULT_RISK_LIMITS } from '../src/domain/risk/risk-config.js';
import { FALLBACK_SPEC, type ContractSpec } from '../src/domain/futures/contract-spec.js';

const makeInput = (over: Partial<SizingInput> = {}): SizingInput => ({
  equity: 10_000,
  availableMargin: 10_000,
  direction: 'LONG',
  entry: 150,
  stop: 148,
  requestedLeverage: 2,
  fundingRate: 0.0001,
  fundingPeriods: 3,
  spec: FALLBACK_SPEC('SOL'),
  limits: DEFAULT_RISK_LIMITS,
  circuitMultiplier: 1,
  ...over,
});

/** CoinDCX USDT perpetuals as merged by mergeSpec in contract-registry (stricter-of-both). */
const SOL_VENUE: ContractSpec = {
  pair: 'B-SOL_USDT', baseAsset: 'SOL', quoteAsset: 'USDT', tickSize: 0.01, lotSize: 0.01,
  minQuantity: 0.01, maxQuantity: 90_000, minNotional: 6, maxLeverage: 5, maintenanceMarginRate: 0.005,
};
const XRP_VENUE: ContractSpec = {
  pair: 'B-XRP_USDT', baseAsset: 'XRP', quoteAsset: 'USDT', tickSize: 0.0001, lotSize: 0.1,
  minQuantity: 0.1, maxQuantity: 9_222_449, minNotional: 6, maxLeverage: 10, maintenanceMarginRate: 0.005,
};
const ETH_VENUE: ContractSpec = {
  pair: 'B-ETH_USDT', baseAsset: 'ETH', quoteAsset: 'USDT', tickSize: 0.01, lotSize: 0.001,
  minQuantity: 0.001, maxQuantity: 9_000, minNotional: 24, maxLeverage: 20, maintenanceMarginRate: 0.005,
};

const at100 = (over: Partial<SizingInput> = {}): SizingInput => ({
  equity: 100, availableMargin: 100, direction: 'LONG', entry: 116.4, stop: 115.236,
  requestedLeverage: 5, fundingRate: 0, spec: SOL_VENUE, limits: DEFAULT_RISK_LIMITS,
  circuitMultiplier: 1, ...over,
});

describe('PositionSizer pipeline', () => {
  const limits = DEFAULT_RISK_LIMITS;

  it('sizes so that effective risk stays within the risk budget', () => {
    const r = sizePosition(makeInput());
    expect(r.ok).toBe(true);
    const budget = 10_000 * limits.maxRiskPerTradePercent / 100;
    expect(r.riskAmount).toBeLessThanOrEqual(budget * 1.02);
    // risk = qty * (stopDistance + fees + funding)
    const expectedPerUnit = 2 + 150 * (limits.feeRateTaker + limits.slippageBufferRate) * 2 +
      150 * 0.0001 * 3;
    expect(r.effectiveRiskPerUnit).toBeCloseTo(expectedPerUnit, 8);
  });

  it('rounds quantity down to the lot step', () => {
    const r = sizePosition(makeInput({ spec: { ...FALLBACK_SPEC('BTC'), lotSize: 0.001 } }));
    expect(r.ok).toBe(true);
    expect((r.quantity * 1000) % 1).toBeCloseTo(0, 6);
  });

  it('circuit multiplier reduces size proportionally', () => {
    const full = sizePosition(makeInput());
    const reduced = sizePosition(makeInput({ circuitMultiplier: 0.5 }));
    expect(reduced.quantity).toBeLessThan(full.quantity);
    expect(reduced.riskAmount).toBeLessThan(full.riskAmount);
  });

  it('rejects when min notional would breach the risk budget', () => {
    const r = sizePosition(makeInput({
      equity: 50,
      entry: 100_000,
      stop: 99_000,
      spec: { ...FALLBACK_SPEC('BTC'), minNotional: 100, minQuantity: 0.001, lotSize: 0.001 },
    }));
    expect(r.ok).toBe(false);
  });

  it('enforces max notional cap', () => {
    const capped = { ...DEFAULT_RISK_LIMITS, maxNotionalPerTrade: 500 };
    const r = sizePosition(makeInput({ limits: capped }));
    expect(r.ok).toBe(true);
    expect(r.notional).toBeLessThanOrEqual(500 + 1e-9);
  });

  it('rejects zero stop distance', () => {
    const r = sizePosition(makeInput({ stop: 150 }));
    expect(r.ok).toBe(false);
    expect(r.rejection).toMatch(/stop distance/);
  });

  it('rejects when margin exceeds available', () => {
    const r = sizePosition(makeInput({ availableMargin: 1 }));
    expect(r.ok).toBe(false);
    expect(r.rejection).toMatch(/margin/);
  });

  it('refuses a trade whose venue leverage ceiling is below the band floor', () => {
    const spec = { ...FALLBACK_SPEC('SOL'), maxLeverage: 2 };
    const r = sizePosition(makeInput({ requestedLeverage: 10, spec }));
    expect(r.ok).toBe(false);
    expect(r.rejection).toMatch(/leverage ceiling 2 below band floor 5/);
  });

  it('floors requested leverage to the band minimum and caps it at the ceiling', () => {
    expect(sizePosition(makeInput({ requestedLeverage: 2 })).leverage).toBe(5);
    expect(sizePosition(makeInput({ requestedLeverage: 30 })).leverage).toBe(15);
  });

  it('rounds min-notional quantity UP to the lot step (ceil, not floor)', () => {
    // entry 97, minNotional 100, lot 1: flooring 100/97 to the lot step
    // gives 1 (notional 97 < 100 — the old bug); ceiling gives 2.
    const spec = { ...FALLBACK_SPEC('TST'), lotSize: 1, minQuantity: 1, minNotional: 100 };
    const r = sizePosition(makeInput({
      entry: 97,
      stop: 96,
      equity: 100_000,
      availableMargin: 100_000,
      spec,
    }));
    expect(r.ok).toBe(true);
    expect(r.quantity).toBeGreaterThanOrEqual(2);
    expect(r.notional).toBeGreaterThanOrEqual(100);
    expect(r.quantity % 1).toBeCloseTo(0, 8); // lot aligned
  });
});

describe('PositionSizer — $100 account on real CoinDCX perpetual constraints', () => {
  it('sizes SOL at a 1% stop to 0.17 SOL, $19.79 notional, 5x, inside the risk budget', () => {
    const r = sizePosition(at100());
    expect(r.ok).toBe(true);
    expect(r.quantity).toBeCloseTo(0.17, 8);
    expect(r.notional).toBeCloseTo(19.788, 6);
    expect(r.leverage).toBe(5);
    expect(r.riskAmount).toBeCloseTo(0.2375, 3);
    expect(r.riskAmount).toBeLessThanOrEqual(0.25 * 1.02);
  });

  it('sizes XRP at a 2% stop to 7.9 XRP on the 0.1 lot', () => {
    const entry = 1.4235;
    const r = sizePosition(at100({ entry, stop: entry * 0.98, spec: XRP_VENUE }));
    expect(r.ok).toBe(true);
    expect(r.quantity).toBeCloseTo(7.9, 8);
  });

  it('refuses ETH at $100: the 24 USDT venue minimum exceeds the 20% symbol cap', () => {
    const entry = 2577.14;
    const r = sizePosition(at100({ entry, stop: entry * 0.995, spec: ETH_VENUE }));
    expect(r.ok).toBe(false);
    expect(r.rejection).toMatch(/notional/);
  });

  it('caps notional at the per-symbol equity share and warns', () => {
    const r = sizePosition(at100({ limits: { ...DEFAULT_RISK_LIMITS, maxRiskPerTradePercent: 5 } }));
    expect(r.ok).toBe(true);
    expect(r.notional).toBeLessThanOrEqual(20 + 1e-9);
    expect(r.warnings).toContain('quantity reduced by notional cap');
    expect(r.quantity).toBeCloseTo(0.17, 8);
  });

  it('rejects a venue whose maximum leverage cannot support the 5x band floor', () => {
    const r = sizePosition(at100({ spec: { ...SOL_VENUE, maxLeverage: 4 } }));
    expect(r.ok).toBe(false);
    expect(r.rejection).toMatch(/band floor 5/);
  });
});
