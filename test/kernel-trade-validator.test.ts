import { describe, it, expect } from 'vitest';
import { validateProposal, computeRr } from '../src/domain/orders/trade-proposal.js';
import type { TradeProposal } from '../src/domain/orders/trade-proposal.js';
import { DEFAULT_RISK_LIMITS } from '../src/domain/risk/risk-config.js';

const base = (over: Partial<TradeProposal>): TradeProposal => ({
  symbol: 'SOLUSDT',
  direction: 'LONG',
  entry: 150,
  stopLoss: 148,
  takeProfit: 155.2,
  orderType: 'MARKET',
  leverage: 2,
  setupType: 'TEST',
  confidence: 0.8,
  thesis: 'test thesis',
  invalidation: 'below 148',
  source: 'SETUP_ENGINE',
  ...over,
});

describe('TradeValidator invariants', () => {
  const limits = DEFAULT_RISK_LIMITS;

  it('accepts a valid LONG with RR >= min', () => {
    const v = validateProposal(base({}), limits.minRiskRewardRatio, limits.maxLeverage);
    expect(v.valid).toBe(true);
    expect(v.rr).toBeCloseTo(2.6, 5);
  });

  it('accepts a valid SHORT with RR >= min', () => {
    const v = validateProposal(
      base({ direction: 'SHORT', entry: 150, stopLoss: 152, takeProfit: 144.6 }),
      limits.minRiskRewardRatio, limits.maxLeverage
    );
    expect(v.valid).toBe(true);
    expect(v.rr).toBeCloseTo(2.7, 5);
  });

  it('rejects LONG with SL above entry', () => {
    const v = validateProposal(
      base({ stopLoss: 151 }),
      limits.minRiskRewardRatio, limits.maxLeverage
    );
    expect(v.valid).toBe(false);
    expect(v.reasons.join(' ')).toMatch(/SL < entry/);
  });

  it('rejects when RR below minimum', () => {
    const v = validateProposal(
      base({ takeProfit: 151.5 }),
      limits.minRiskRewardRatio, limits.maxLeverage
    );
    expect(v.valid).toBe(false);
    expect(v.reasons.join(' ')).toMatch(/below minimum/);
  });

  it('rejects leverage above the cap', () => {
    const v = validateProposal(
      base({ leverage: 5 }),
      limits.minRiskRewardRatio, limits.maxLeverage
    );
    expect(v.valid).toBe(false);
    expect(v.reasons.join(' ')).toMatch(/leverage/);
  });

  it('computes R:R deterministically for both directions', () => {
    const long = computeRr(base({}));
    expect(long.risk).toBe(2);
    expect(long.reward).toBeCloseTo(5.2, 5);
    const short = computeRr(base({ direction: 'SHORT', stopLoss: 152, takeProfit: 145 }));
    expect(short.risk).toBe(2);
    expect(short.reward).toBe(5);
  });
});
