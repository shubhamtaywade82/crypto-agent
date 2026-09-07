import { describe, it, expect } from 'vitest';
import { sizePosition } from '../src/engines/position-sizer.js';
import type { SizingInput } from '../src/engines/position-sizer.js';
import { DEFAULT_RISK_LIMITS } from '../src/domain/risk/risk-config.js';
import { FALLBACK_SPEC } from '../src/domain/futures/contract-spec.js';

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

  it('leverage is clamped to limits and spec max', () => {
    const spec = { ...FALLBACK_SPEC('SOL'), maxLeverage: 2 };
    const r = sizePosition(makeInput({ requestedLeverage: 10, spec }));
    expect(r.leverage).toBe(2);
  });
});
