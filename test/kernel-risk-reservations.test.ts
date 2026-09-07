import { describe, it, expect } from 'vitest';
import { RiskReservationManager } from '../src/engines/risk-reservations.js';
import { DEFAULT_RISK_LIMITS } from '../src/domain/risk/risk-config.js';
import { emptyPortfolio } from '../src/domain/portfolio/portfolio-state.js';

const limits = { ...DEFAULT_RISK_LIMITS, maxConcurrentPositions: 1 };

describe('RiskReservationManager — global risk reservations', () => {
  it('places, commits and retires a reservation', () => {
    const mgr = new RiskReservationManager();
    const portfolio = emptyPortfolio(10_000);
    const check = mgr.reserve(portfolio, {
      symbol: 'SOLUSDT', cluster: 'ALT', notional: 1_000,
      riskAmount: 25, addsPosition: true,
    }, limits);
    expect(check.ok).toBe(true);
    const id = check.reservation!.id;

    mgr.commit(id);
    expect(mgr.get(id)?.state).toBe('COMMITTED');
    // Committed reservations no longer count toward future projections
    // (the fill is visible in broker state instead).
    expect(mgr.activeNotional()).toBe(0);
  });

  it('a second concurrent lane cannot exceed maxConcurrentPositions', () => {
    const mgr = new RiskReservationManager();
    const portfolio = emptyPortfolio(10_000);

    const first = mgr.reserve(portfolio, {
      symbol: 'BTCUSDT', cluster: 'BTC', notional: 1_000,
      riskAmount: 25, addsPosition: true,
    }, limits);
    expect(first.ok).toBe(true);

    // Different symbol, same global portfolio — the old per-symbol lanes
    // both read openPositions=0 and approved; the reservation gate must
    // decline this second lane.
    const second = mgr.reserve(portfolio, {
      symbol: 'SOLUSDT', cluster: 'ALT', notional: 1_000,
      riskAmount: 25, addsPosition: true,
    }, limits);
    expect(second.ok).toBe(false);
    expect(second.rejections).toContain('MAX_POSITIONS_EXCEEDED');
  });

  it('projects gross exposure including active reservations', () => {
    const mgr = new RiskReservationManager();
    const portfolio = emptyPortfolio(10_000);
    const tight = { ...DEFAULT_RISK_LIMITS, maxPortfolioGrossExposurePercent: 20 };

    const first = mgr.reserve(portfolio, {
      symbol: 'BTCUSDT', cluster: 'BTC', notional: 1_500,
      riskAmount: 25, addsPosition: true,
    }, tight);
    expect(first.ok).toBe(true);

    // 1,500 reserved + 700 new = 2,200 = 22% > 20% cap.
    const second = mgr.reserve(portfolio, {
      symbol: 'ETHUSDT', cluster: 'ETH', notional: 700,
      riskAmount: 25, addsPosition: true,
    }, tight);
    expect(second.ok).toBe(false);
    expect(second.rejections).toContain('PORTFOLIO_EXPOSURE_EXCEEDED');
  });

  it('projects symbol and correlated-cluster exposure across lanes', () => {
    const mgr = new RiskReservationManager();
    const portfolio = emptyPortfolio(10_000);
    const tight = { ...DEFAULT_RISK_LIMITS, maxCorrelatedExposurePercent: 30 };

    const first = mgr.reserve(portfolio, {
      symbol: 'SOLUSDT', cluster: 'ALT', notional: 2_000,
      riskAmount: 25, addsPosition: true,
    }, tight);
    expect(first.ok).toBe(true);

    // Another ALT-cluster lane: 2,000 + 1,100 = 31% > 30%.
    const second = mgr.reserve(portfolio, {
      symbol: 'AVAXUSDT', cluster: 'ALT', notional: 1_100,
      riskAmount: 25, addsPosition: true,
    }, tight);
    expect(second.ok).toBe(false);
    expect(second.rejections).toContain('CORRELATED_EXPOSURE_EXCEEDED');
  });

  it('releasing a reservation frees the risk budget', () => {
    const mgr = new RiskReservationManager();
    const portfolio = emptyPortfolio(10_000);

    const first = mgr.reserve(portfolio, {
      symbol: 'BTCUSDT', cluster: 'BTC', notional: 1_000,
      riskAmount: 25, addsPosition: true,
    }, limits);
    mgr.release(first.reservation!.id);

    const second = mgr.reserve(portfolio, {
      symbol: 'SOLUSDT', cluster: 'ALT', notional: 1_000,
      riskAmount: 25, addsPosition: true,
    }, limits);
    expect(second.ok).toBe(true);
  });

  it('expires stale reservations via TTL sweep', () => {
    const mgr = new RiskReservationManager();
    const portfolio = emptyPortfolio(10_000);
    const check = mgr.reserve(portfolio, {
      symbol: 'BTCUSDT', cluster: 'BTC', notional: 1_000,
      riskAmount: 25, addsPosition: true,
      ttlMs: 50,
    }, limits);
    expect(check.ok).toBe(true);

    const expired = mgr.sweepExpired(Date.now() + 100);
    expect(expired).toHaveLength(1);
    expect(mgr.get(expired[0])?.state).toBe('EXPIRED');

    // Budget is free again after expiry.
    const second = mgr.reserve(portfolio, {
      symbol: 'SOLUSDT', cluster: 'ALT', notional: 1_000,
      riskAmount: 25, addsPosition: true,
    }, limits);
    expect(second.ok).toBe(true);
  });

  it('enforces maxNotionalPerTrade', () => {
    const mgr = new RiskReservationManager();
    const check = mgr.reserve(emptyPortfolio(10_000), {
      symbol: 'BTCUSDT', cluster: 'BTC', notional: DEFAULT_RISK_LIMITS.maxNotionalPerTrade + 1,
      riskAmount: 25, addsPosition: true,
    }, DEFAULT_RISK_LIMITS);
    expect(check.ok).toBe(false);
    expect(check.rejections).toContain('MAX_NOTIONAL_EXCEEDED');
  });
});
