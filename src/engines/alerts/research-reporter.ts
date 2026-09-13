import { allCellStatistics } from '../../learning/statistics.js';
import { checkGate, DEFAULT_GATE, type StrategyRegistry } from '../../learning/strategy-registry.js';
import type { TradeLedger } from '../../learning/trade-ledger.js';
import type { PerformanceEngine } from '../performance-engine.js';
import { makeAlert } from './make-alert.js';
import type { AlertDispatcher } from './dispatcher.js';
import type { AlertSubscriptions } from './subscriptions.js';

interface ResearchDeps {
  readonly dispatcher: AlertDispatcher;
  readonly performance: PerformanceEngine;
  readonly ledger: TradeLedger;
  readonly strategies: StrategyRegistry;
  readonly subs: AlertSubscriptions;
}

export class ResearchReporter {
  private lastDailyDay = -1;
  private readonly promoted = new Set<string>();
  private readonly dispatcher: AlertDispatcher;
  private readonly performance: PerformanceEngine;
  private readonly ledger: TradeLedger;
  private readonly strategies: StrategyRegistry;
  private readonly subs: AlertSubscriptions;

  constructor(deps: ResearchDeps) {
    this.dispatcher = deps.dispatcher;
    this.performance = deps.performance;
    this.ledger = deps.ledger;
    this.strategies = deps.strategies;
    this.subs = deps.subs;
  }

  async tick(now = Date.now()): Promise<void> {
    if (this.subs.researchReports !== 'daily') return;
    const day = Math.floor(now / 86_400_000);
    if (day !== this.lastDailyDay) {
      this.lastDailyDay = day;
      await this.daily(now);
    }
    await this.promotions(now);
  }

  private async daily(now: number): Promise<void> {
    const s = this.performance.stats();
    const cells = allCellStatistics(this.ledger.outcomes);
    const best = [...cells].sort((a, b) => b.expectancyR - a.expectancyR)[0];
    const weak = [...cells].sort((a, b) => a.expectancyR - b.expectancyR)[0];
    await this.dispatcher.publish(makeAlert({
      at: now,
      class: 'RESEARCH',
      severity: 'INFO',
      title: 'DAILY TRADING INTELLIGENCE',
      body: [
        `Closed: ${s.tradeCount}  Win: ${s.winCount}  Loss: ${s.lossCount}`,
        `Win rate: ${(s.winRate * 100).toFixed(1)}%  Expectancy: ${s.expectancy.toFixed(2)}`,
        best ? `Best cell: ${best.cell} ${best.expectancyR.toFixed(2)}R n=${best.n}` : 'Best cell: —',
        weak ? `Weakest cell: ${weak.cell} ${weak.expectancyR.toFixed(2)}R` : '',
      ].filter(Boolean).join('\n'),
      fingerprint: 'RESEARCH:daily',
      stateTo: `day-${Math.floor(now / 86_400_000)}`,
      payload: { tradeCount: s.tradeCount },
    }));
  }

  private async promotions(now: number): Promise<void> {
    const stats = allCellStatistics(this.ledger.outcomes);
    for (const strat of this.strategies.all()) {
      for (const cell of stats) {
        const key = `${strat.strategyId}:${cell.cell}`;
        if (this.promoted.has(key) || strat.approvedCells.includes(cell.cell)) continue;
        const verdict = checkGate(cell, strat.gate ?? DEFAULT_GATE);
        if (!verdict.promoted) continue;
        this.promoted.add(key);
        await this.dispatcher.publish(makeAlert({
          at: now,
          class: 'RESEARCH',
          severity: 'IMPORTANT',
          title: 'STRATEGY LEARNING UPDATE',
          body: [
            `${strat.strategyId} ${cell.cell}`,
            `Samples: ${cell.n}`,
            `Expectancy: ${cell.expectancyR.toFixed(2)}R  Win: ${(cell.winRate * 100).toFixed(1)}%`,
            'Status: PROMOTION ELIGIBLE',
          ].join('\n'),
          fingerprint: `RESEARCH:promo:${key}`,
          stateTo: 'ELIGIBLE',
          payload: { cell: cell.cell, n: cell.n, expectancyR: cell.expectancyR },
        }));
      }
    }
  }
}
