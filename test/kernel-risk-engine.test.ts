import { describe, it, expect } from 'vitest';
import { evaluateRisk } from '../src/engines/risk-engine.js';
import { sizePosition } from '../src/engines/position-sizer.js';
import { validateProposal } from '../src/domain/orders/trade-proposal.js';
import type { TradeProposal } from '../src/domain/orders/trade-proposal.js';
import { DEFAULT_RISK_LIMITS, deriveCircuitState, circuitRiskMultiplier } from '../src/domain/risk/risk-config.js';
import type { RiskLimits } from '../src/domain/risk/risk-config.js';
import { emptyPortfolio } from '../src/domain/portfolio/portfolio-state.js';
import type { PortfolioState } from '../src/domain/portfolio/portfolio-state.js';
import { FALLBACK_SPEC } from '../src/domain/futures/contract-spec.js';

const limits: RiskLimits = DEFAULT_RISK_LIMITS;
const proposal: TradeProposal = {
  symbol: 'SOLUSDT', direction: 'LONG', entry: 150, stopLoss: 148, takeProfit: 155.5,
  orderType: 'MARKET', leverage: 2, setupType: 'TEST', confidence: 0.8,
  thesis: 't', invalidation: 'i', source: 'SETUP_ENGINE',
};
const spec = FALLBACK_SPEC('SOL');
const validation = validateProposal(proposal, limits.minRiskRewardRatio, limits.maxLeverage);
const sizingFor = (equity: number, pf: PortfolioState = emptyPortfolio(equity)) =>
  sizePosition({
    equity, availableMargin: pf.availableMargin, direction: proposal.direction,
    entry: proposal.entry, stop: proposal.stopLoss, requestedLeverage: 2,
    fundingRate: 0.0001, spec, limits, circuitMultiplier: 1,
  });

describe('RiskEngine — the final authority', () => {
  it('approves a healthy proposal on an empty portfolio', () => {
    const pf = emptyPortfolio(10_000);
    const d = evaluateRisk({
      proposal, validation, sizing: sizingFor(10_000, pf), portfolio: pf,
      limits, marketStateAgeMs: 100,
    });
    expect(d.approved).toBe(true);
    expect(d.checks.every((c) => c.passed)).toBe(true);
    expect(d.circuitState).toBe('NORMAL');
  });

  it('rejects structurally invalid proposals', () => {
    const bad = validateProposal(
      { ...proposal, stopLoss: 151 }, limits.minRiskRewardRatio, limits.maxLeverage
    );
    const pf = emptyPortfolio(10_000);
    const d = evaluateRisk({
      proposal, validation: bad, sizing: sizingFor(10_000, pf), portfolio: pf,
      limits, marketStateAgeMs: 100,
    });
    expect(d.approved).toBe(false);
    expect(d.rejections).toContain('MIN_RR_NOT_MET');
  });

  it('rejects stale market state', () => {
    const pf = emptyPortfolio(10_000);
    const d = evaluateRisk({
      proposal, validation, sizing: sizingFor(10_000, pf), portfolio: pf,
      limits, marketStateAgeMs: 60_000,
    });
    expect(d.approved).toBe(false);
  });

  it('rejects when position limit reached', () => {
    const pf: PortfolioState = {
      ...emptyPortfolio(10_000),
      openPositions: limits.maxConcurrentPositions,
    };
    const d = evaluateRisk({
      proposal, validation, sizing: sizingFor(10_000, pf), portfolio: pf,
      limits, marketStateAgeMs: 100,
    });
    expect(d.approved).toBe(false);
  });

  it('rejects when symbol exposure would breach the cap', () => {
    const pf: PortfolioState = {
      ...emptyPortfolio(10_000),
      exposures: [{ symbol: 'SOLUSDT', notional: 2200, direction: 'LONG', cluster: 'ALT' }],
      grossExposure: 2200,
    };
    const d = evaluateRisk({
      proposal, validation, sizing: sizingFor(10_000, pf), portfolio: pf,
      limits, marketStateAgeMs: 100,
    });
    expect(d.approved).toBe(false);
  });

  it('HALTs on daily loss limit and EMERGENCY on drawdown', () => {
    const halted = { ...emptyPortfolio(10_000), dailyLossPercent: 1.5 };
    const d1 = evaluateRisk({
      proposal, validation, sizing: sizingFor(10_000, halted), portfolio: halted,
      limits, marketStateAgeMs: 100,
    });
    expect(d1.approved).toBe(false);
    expect(d1.rejections).toContain('CIRCUIT_HALTED');

    const emergency = { ...emptyPortfolio(10_000), drawdownPercent: 6 };
    const d2 = evaluateRisk({
      proposal, validation, sizing: sizingFor(10_000, emergency), portfolio: emergency,
      limits, marketStateAgeMs: 100,
    });
    expect(d2.rejections).toContain('CIRCUIT_HALTED');
    expect(d2.circuitState).toBe('EMERGENCY');
  });
});

describe('circuit breaker mapping', () => {
  it('maps damage levels to states', () => {
    expect(deriveCircuitState(0, 0, 0, limits)).toBe('NORMAL');
    expect(deriveCircuitState(0.6, 0, 0, limits)).toBe('CAUTION');
    expect(deriveCircuitState(0.9, 0, 0, limits)).toBe('REDUCED');
    expect(deriveCircuitState(1.2, 0, 0, limits)).toBe('HALTED');
    expect(deriveCircuitState(0.1, 6, 0, limits)).toBe('EMERGENCY');
    expect(deriveCircuitState(0, 0, 3, limits)).toBe('REDUCED');
  });

  it('zeroes the risk budget when halted', () => {
    expect(circuitRiskMultiplier('HALTED')).toBe(0);
    expect(circuitRiskMultiplier('EMERGENCY')).toBe(0);
    expect(circuitRiskMultiplier('REDUCED')).toBe(0.5);
  });
});
