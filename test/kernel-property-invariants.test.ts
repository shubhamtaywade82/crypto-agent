import fc from 'fast-check';
import { describe, it, expect } from 'vitest';
import { validateProposal, computeRr } from '../src/domain/orders/trade-proposal.js';
import type { TradeProposal } from '../src/domain/orders/trade-proposal.js';
import { DEFAULT_RISK_LIMITS } from '../src/domain/risk/risk-config.js';
import { sizePosition } from '../src/engines/position-sizer.js';
import { liquidationPrice } from '../src/domain/positions/position-view.js';
import { FALLBACK_SPEC } from '../src/domain/futures/contract-spec.js';
import { canTransition } from '../src/domain/orders/order-state.js';
import type { SizingInput } from '../src/engines/position-sizer.js';
import type { OrderStatus } from '../src/domain/orders/order-state.js';

const limits = DEFAULT_RISK_LIMITS;
const MIN_RR = limits.minRiskRewardRatio;

/** Generates structurally valid proposals with RR >= MIN_RR. */
const validProposalArb = fc.record({
  direction: fc.constantFrom('LONG', 'SHORT') as fc.Arbitrary<'LONG' | 'SHORT'>,
  entry: fc.integer({ min: 1, max: 100_000 }),
  riskDistance: fc.integer({ min: 1, max: 5_000 }),
  rrMultiple: fc.integer({ min: Math.ceil(MIN_RR * 100), max: 1_000 }),
  leverage: fc.integer({ min: 1, max: limits.maxLeverage }),
  confidence: fc.double({ min: 0, max: 1, noNaN: true }),
}).map((r) => {
  const stop = r.direction === 'LONG' ? r.entry - r.riskDistance : r.entry + r.riskDistance;
  const rr = r.rrMultiple / 100;
  const reward = r.riskDistance * rr;
  const tp = r.direction === 'LONG' ? r.entry + reward : r.entry - reward;
  const p: TradeProposal = {
    symbol: 'SOLUSDT', direction: r.direction, entry: r.entry,
    stopLoss: stop, takeProfit: tp, orderType: 'MARKET', leverage: r.leverage,
    setupType: 'PROP', confidence: r.confidence, thesis: 'p', invalidation: 'i',
    source: 'SETUP_ENGINE',
  };
  return p;
});

const ALL_STATUSES: OrderStatus[] = [
  'ORDER_INTENT', 'RISK_APPROVED', 'SUBMITTING', 'SUBMITTED', 'ACKNOWLEDGED',
  'PARTIALLY_FILLED', 'FILLED', 'POSITION_OPEN', 'PROTECTED', 'EXIT_REQUESTED',
  'CLOSED', 'REJECTED', 'CANCELLED', 'EXPIRED', 'UNKNOWN',
];

describe('property: trade proposal invariants', () => {
  it('for every valid proposal the structural inequalities hold', () => {
    const prop = fc.property(validProposalArb, (p) => {
      const v = validateProposal(p, MIN_RR, limits.maxLeverage);
      fc.pre(v.valid);
      if (p.direction === 'LONG') {
        expect(p.stopLoss).toBeLessThan(p.entry);
        expect(p.entry).toBeLessThan(p.takeProfit);
      } else {
        expect(p.takeProfit).toBeLessThan(p.entry);
        expect(p.entry).toBeLessThan(p.stopLoss);
      }
      const rr = computeRr(p);
      expect(rr.rr).toBeGreaterThanOrEqual(MIN_RR - 1e-9);
    });
    fc.assert(prop, { seed: 42, numRuns: 300 });
  });

  it('RR is never negative for any generated proposal', () => {
    const prop = fc.property(validProposalArb, (p) => {
      expect(computeRr(p).rr).toBeGreaterThanOrEqual(0);
    });
    fc.assert(prop, { seed: 7, numRuns: 300 });
  });
});

const sizingInputArb: fc.Arbitrary<SizingInput> = fc.record({
  equity: fc.double({ min: 500, max: 1_000_000, noNaN: true }),
  availableMargin: fc.double({ min: 0, max: 1_000_000, noNaN: true }),
  direction: fc.constantFrom('LONG', 'SHORT') as fc.Arbitrary<'LONG' | 'SHORT'>,
  entry: fc.double({ min: 0.5, max: 100_000, noNaN: true }),
  stopDistancePct: fc.double({ min: 0.0005, max: 0.1, noNaN: true }),
  requestedLeverage: fc.integer({ min: 1, max: limits.maxLeverage }),
  fundingRate: fc.double({ min: -0.001, max: 0.001, noNaN: true }),
  circuitMultiplier: fc.double({ min: 0, max: 1, noNaN: true }),
}).map((r) => ({
  equity: r.equity,
  availableMargin: r.availableMargin,
  direction: r.direction,
  entry: r.entry,
  stop: r.direction === 'LONG' ? r.entry * (1 - r.stopDistancePct) : r.entry * (1 + r.stopDistancePct),
  requestedLeverage: r.requestedLeverage,
  fundingRate: r.fundingRate,
  fundingPeriods: 3,
  spec: FALLBACK_SPEC('SOL'),
  limits,
  circuitMultiplier: r.circuitMultiplier,
}));

describe('property: position sizing never exceeds the risk budget', () => {
  it('ok sizing implies riskAmount <= riskBudget * 1.02 (prop-firm 0.25%)', () => {
    const prop = fc.property(sizingInputArb, (input) => {
      const r = sizePosition(input);
      if (!r.ok) return;
      const budget = input.equity * limits.maxRiskPerTradePercent / 100 * input.circuitMultiplier;
      expect(r.riskAmount).toBeLessThanOrEqual(budget * 1.02 + 1e-6);
      expect(r.quantity).toBeGreaterThanOrEqual(input.spec.minQuantity - 1e-12);
      expect(r.leverage).toBeLessThanOrEqual(limits.maxLeverage);
      expect(r.notional).toBeLessThanOrEqual(
        Math.min(limits.maxNotionalPerTrade, input.spec.maxQuantity * input.entry) + 1e-6
      );
    });
    fc.assert(prop, { seed: 99, numRuns: 500 });
  });

  it('quantity is always lot-step aligned', () => {
    const prop = fc.property(sizingInputArb, (input) => {
      const r = sizePosition(input);
      if (!r.ok) return;
      const steps = r.quantity / input.spec.lotSize;
      expect(steps - Math.floor(steps)).toBeLessThan(1e-6);
    });
    fc.assert(prop, { seed: 13, numRuns: 300 });
  });
});

describe('property: liquidation price geometry', () => {
  it('LONG liquidates below entry; SHORT liquidates above entry', () => {
    const prop = fc.property(
      fc.double({ min: 0.5, max: 100_000, noNaN: true }),
      fc.integer({ min: 1, max: 20 }),
      fc.double({ min: 0.001, max: 0.005, noNaN: true }),
      (entry, leverage, mmr) => {
        const long = liquidationPrice(entry, leverage, 'LONG', mmr);
        const short = liquidationPrice(entry, leverage, 'SHORT', mmr);
        expect(long).toBeLessThan(entry);
        expect(short).toBeGreaterThan(entry);
      }
    );
    fc.assert(prop, { seed: 5, numRuns: 300 });
  });
});

describe('property: order FSM safety', () => {
  it('terminal states never transition onward', () => {
    const prop = fc.property(
      fc.constantFrom('CLOSED', 'REJECTED', 'CANCELLED', 'EXPIRED') as fc.Arbitrary<OrderStatus>,
      fc.constantFrom(...ALL_STATUSES),
      (from, to) => {
        expect(canTransition(from, to)).toBe(false);
      }
    );
    fc.assert(prop, { seed: 21, numRuns: 200 });
  });

  it('no single transition returns to ORDER_INTENT or RISK_APPROVED', () => {
    const prop = fc.property(
      fc.constantFrom(...ALL_STATUSES),
      (from) => {
        expect(canTransition(from, 'ORDER_INTENT')).toBe(false);
        if (from !== 'ORDER_INTENT') expect(canTransition(from, 'RISK_APPROVED')).toBe(false);
      }
    );
    fc.assert(prop, { seed: 33, numRuns: 200 });
  });
});
