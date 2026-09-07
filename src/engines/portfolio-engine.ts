import type { IExecutionBroker, BrokerPosition } from '../infrastructure/broker/broker.js';
import type { PortfolioState, SymbolExposure } from '../domain/portfolio/portfolio-state.js';
import { clusterOf } from '../domain/portfolio/portfolio-state.js';
import {
  FxRateCache, normalizeBalances,
  type FxFreshness, type ValuationResult,
} from '../domain/portfolio/valuation.js';
import type { RiskLimits } from '../domain/risk/risk-config.js';
import type { PerformanceEngine } from './performance-engine.js';

/** Pluggable performance metrics source (PerformanceEngine-backed). */
export interface PortfolioMetricsSource {
  /** Realized PnL for the current trading day (canonical USDT). */
  getDailyRealizedPnl(): number;
  /** Current consecutive-loss streak. */
  getLossStreak(): number;
  /** Peak-to-valley drawdown in percent of equity high-water mark. */
  getDrawdownPercent(): number;
}

const staticSource = (): PortfolioMetricsSource => ({
  getDailyRealizedPnl: () => 0,
  getLossStreak: () => 0,
  getDrawdownPercent: () => 0,
});

export const toExposure = (p: BrokerPosition): SymbolExposure => {
  const symbol = p.pair.split('_')[0]?.replace(/^[^-]-/, '') ?? p.pair;
  return {
    symbol,
    notional: Math.abs(p.size * p.entryPrice),
    direction: p.side === 'long' ? 'LONG' : 'SHORT',
    cluster: clusterOf(symbol),
  };
};

export interface PortfolioEngineOptions {
  readonly broker: IExecutionBroker;
  readonly metrics?: PortfolioMetricsSource;
  readonly fallbackEquity?: number;
  readonly limits: RiskLimits;
  /**
   * Live USDT/INR rate source for canonical valuation. Required when the
   * account holds INR balances (CoinDCX INR-margined routes); without it
   * INR balances are EXCLUDED from equity — never summed as if they were
   * USDT.
   */
  readonly usdtInrRate?: () => Promise<number>;
  /** Real performance ledger (daily PnL, loss streak, drawdown). */
  readonly performance?: PerformanceEngine;
}

/**
 * Aggregates live broker state into the PortfolioState consumed by the
 * RiskEngine. Read-only; never mutates broker state.
 *
 * Kernel v3 accounting rules:
 *  - every balance is normalized into the canonical USDT basis through
 *    a TTL-bounded FX rate (10,000 INR + 1,000 USDT != 11,000);
 *  - daily PnL / loss streak / drawdown come from the PerformanceEngine
 *    measured off real outcomes, not hardcoded zeros;
 *  - every snapshot records its valuation provenance (fxRate,
 *    freshness, excluded currencies) for auditability.
 */
export class PortfolioEngine {
  private readonly broker: IExecutionBroker;
  private readonly metrics: PortfolioMetricsSource;
  private readonly fallbackEquity: number;
  private readonly limits: RiskLimits;
  private readonly fx?: FxRateCache;
  private readonly usdtInrRate?: () => Promise<number>;
  private readonly performance?: PerformanceEngine;
  private lastState?: PortfolioState;
  private lastValuation?: ValuationResult;

  constructor(opts: PortfolioEngineOptions) {
    this.broker = opts.broker;
    this.performance = opts.performance;
    this.metrics = opts.metrics ?? opts.performance?.metricsSource() ?? staticSource();
    this.fallbackEquity = opts.fallbackEquity ?? 0;
    this.limits = opts.limits;
    this.usdtInrRate = opts.usdtInrRate;
    this.fx = opts.usdtInrRate
      ? new FxRateCache({ freshMs: 30_000, staleMs: 300_000 }) // accounting tolerates stale rates
      : undefined;
  }

  async refresh(): Promise<PortfolioState> {
    const [positions, balances] = await Promise.all([
      this.broker.getPositions(),
      this.broker.getBalances(),
    ]);

    const valuation = await this.valuate(balances);
    this.lastValuation = valuation;
    const walletEquity = valuation.equity > 0 ? valuation.equity : this.fallbackEquity;
    const upnl = positions.reduce((acc, p) => acc + (p.unrealizedPnl ?? 0), 0);
    const equity = walletEquity + upnl;

    // Feed the real performance ledger.
    this.performance?.recordEquity(equity);

    const dailyPnl = this.metrics.getDailyRealizedPnl();
    const state = this.assembleState(positions, equity, dailyPnl, valuation);
    this.lastState = state;
    return state;
  }

  private assembleState(
    positions: readonly BrokerPosition[],
    equity: number,
    dailyPnl: number,
    valuation: ValuationResult
  ): PortfolioState {
    const exposures = positions.map(toExposure);
    const usedMargin = positions.reduce(
      (acc, p) => acc + Math.abs(p.size * p.entryPrice) / Math.max(1, p.leverage ?? 1), 0
    );
    return {
      equity,
      availableMargin: Math.max(0, equity - usedMargin),
      usedMargin,
      openPositions: positions.length,
      grossExposure: exposures.reduce((acc, e) => acc + e.notional, 0),
      dailyRealizedPnl: dailyPnl,
      dailyLossPercent: dailyPnl < 0 ? (Math.abs(dailyPnl) / Math.max(1, equity)) * 100 : 0,
      drawdownPercent: this.metrics.getDrawdownPercent(),
      lossStreak: this.metrics.getLossStreak(),
      exposures,
      updatedAt: Date.now(),
      currencyBasis: 'USDT',
      fxRate: valuation.fxRate,
      fxFreshness: valuation.fxFreshness,
      valuationExcluded: valuation.excluded,
    };
  }

  peek(): PortfolioState {
    return this.lastState ?? {
      equity: this.fallbackEquity, availableMargin: this.fallbackEquity, usedMargin: 0,
      openPositions: 0, grossExposure: 0, dailyRealizedPnl: 0, dailyLossPercent: 0,
      drawdownPercent: 0, lossStreak: 0, exposures: [], updatedAt: Date.now(),
      currencyBasis: 'USDT', fxRate: 1, fxFreshness: 'NOT_REQUIRED', valuationExcluded: [],
    };
  }

  /** Last valuation provenance (for health surfaces and audit). */
  get valuation(): ValuationResult | undefined {
    return this.lastValuation;
  }

  get limitsSnapshot(): RiskLimits {
    return this.limits;
  }

  /**
   * Normalize all balances into canonical USDT. INR is converted via a
   * TTL-bounded live rate; if the rate is unavailable the INR balance is
   * EXCLUDED (never mis-added) and the exclusion is surfaced.
   */
  private async valuate(
    balances: readonly { currency: string; total: number }[]
  ): Promise<ValuationResult> {
    const hasInr = balances.some((b) => b.currency.toUpperCase() === 'INR' && b.total !== 0);
    if (!hasInr) {
      return normalizeBalances(balances, 1, 'NOT_REQUIRED');
    }
    if (!this.fx || !this.usdtInrRate) {
      // INR present but no rate source: exclude INR, value the rest.
      const withoutInr = balances.filter((b) => b.currency.toUpperCase() !== 'INR');
      const rest = normalizeBalances(withoutInr, 1, 'NOT_REQUIRED');
      return {
        ...rest,
        excluded: [...rest.excluded, 'INR(unvalued:no-fx-source)'],
      };
    }
    const quote = await this.fx.quote(this.usdtInrRate);
    return normalizeBalances(balances, quote.rate, quote.freshness as FxFreshness);
  }
}
