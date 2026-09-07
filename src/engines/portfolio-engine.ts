import type { IExecutionBroker, BrokerPosition } from '../infrastructure/broker/broker.js';
import type { PortfolioState, SymbolExposure } from '../domain/portfolio/portfolio-state.js';
import { clusterOf } from '../domain/portfolio/portfolio-state.js';
import type { RiskLimits } from '../domain/risk/risk-config.js';

/** Pluggable performance metrics source (journal/event-store backed). */
export interface PortfolioMetricsSource {
  /** Realized PnL for the current trading day (quote currency). */
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
}

/**
 * Aggregates live broker state into the PortfolioState consumed by the
 * RiskEngine. Read-only; never mutates broker state.
 */
export class PortfolioEngine {
  private readonly broker: IExecutionBroker;
  private readonly metrics: PortfolioMetricsSource;
  private readonly fallbackEquity: number;
  private readonly limits: RiskLimits;
  private lastState?: PortfolioState;

  constructor(opts: PortfolioEngineOptions) {
    this.broker = opts.broker;
    this.metrics = opts.metrics ?? staticSource();
    this.fallbackEquity = opts.fallbackEquity ?? 0;
    this.limits = opts.limits;
  }

  async refresh(): Promise<PortfolioState> {
    const [positions, balances] = await Promise.all([
      this.broker.getPositions(),
      this.broker.getBalances(),
    ]);
    const equity = this.computeEquity(balances, positions);
    const usedMargin = positions.reduce(
      (acc, p) => acc + Math.abs(p.size * p.entryPrice) / Math.max(1, p.leverage ?? 1), 0
    );
    const exposures = positions.map(toExposure);
    const dailyPnl = this.metrics.getDailyRealizedPnl();
    const state: PortfolioState = {
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
    };
    this.lastState = state;
    return state;
  }

  peek(): PortfolioState {
    return this.lastState ?? {
      equity: this.fallbackEquity, availableMargin: this.fallbackEquity, usedMargin: 0,
      openPositions: 0, grossExposure: 0, dailyRealizedPnl: 0, dailyLossPercent: 0,
      drawdownPercent: 0, lossStreak: 0, exposures: [], updatedAt: Date.now(),
    };
  }

  get limitsSnapshot(): RiskLimits {
    return this.limits;
  }

  private computeEquity(
    balances: readonly { currency: string; total: number }[],
    positions: readonly BrokerPosition[]
  ): number {
    const wallet = balances
      .filter((b) => b.currency === 'USDT' || b.currency === 'INR')
      .reduce((acc, b) => acc + b.total, 0);
    const upnl = positions.reduce((acc, p) => acc + (p.unrealizedPnl ?? 0), 0);
    const equity = wallet > 0 ? wallet + upnl : this.fallbackEquity + upnl;
    return equity;
  }
}
