import { describe, it, expect } from 'vitest';
import { TradeLedger, cellOf, type TradeFeatureSnapshot } from '../src/learning/trade-ledger.js';
import { computeCellStatistics, allCellStatistics } from '../src/learning/statistics.js';
import { StrategyRegistry } from '../src/learning/strategy-registry.js';
import { EventStore } from '../src/infrastructure/events/event-store.js';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const tempStore = (): EventStore =>
  new EventStore({ filePath: join(mkdtempSync(join(tmpdir(), 'lrn-')), 'events.jsonl') });

const snapshot = (over: Partial<TradeFeatureSnapshot> = {}): TradeFeatureSnapshot => ({
  decisionId: 'decision-1',
  symbol: 'BTCUSDT',
  strategyId: 'MOMO_BREAKOUT',
  direction: 'LONG',
  entry: 100,
  stopLoss: 98,
  takeProfit: 106,
  plannedRr: 3,
  regime: 'TREND_UP',
  fundingRate: 0.0001,
  leverage: 5,
  riskAmount: 20,
  notional: 1_000,
  confidence: 0.7,
  openedAt: 1_700_000_000_000,
  ...over,
});

describe('TradeLedger — feature snapshots to attributed outcomes', () => {
  it('records an open, attributes a close by decisionId, and computes R', () => {
    const ledger = new TradeLedger();
    ledger.recordOpened(snapshot());
    expect(ledger.openTrades).toHaveLength(1);
    expect(ledger.outcomes).toHaveLength(0);

    const outcome = ledger.recordClosed('decision-1', 40, 1_700_000_360_000);
    expect(outcome).toBeDefined();
    expect(outcome?.rMultiple).toBeCloseTo(2, 6); // pnl 40 / risk 20
    expect(outcome?.holdingMinutes).toBeCloseTo(6, 5);
    expect(ledger.openTrades).toHaveLength(0);
    expect(ledger.outcomes).toHaveLength(1);
  });

  it('tracks MAE/MFE in R from mark observations', () => {
    const ledger = new TradeLedger();
    ledger.recordOpened(snapshot()); // entry 100, stop 98 (risk/unit = 2)
    ledger.recordMark('BTCUSDT', 99);   // adverse 0.5R
    ledger.recordMark('BTCUSDT', 103);  // favorable 1.5R
    ledger.recordMark('BTCUSDT', 99.5); // higher low — MAE stays 0.5R
    ledger.recordClosed('decision-1', -20);
    const o = ledger.outcomes[0]!;
    expect(o.maxAdverseR).toBeCloseTo(0.5, 6);
    expect(o.maxFavorableR).toBeCloseTo(1.5, 6);
  });

  it('computes MAE/MFE for SHORTs with sign-aware math', () => {
    const ledger = new TradeLedger();
    ledger.recordOpened(snapshot({
      decisionId: 'short-1', direction: 'SHORT',
      entry: 100, stopLoss: 102, takeProfit: 94, plannedRr: 3,
    }));
    ledger.recordMark('BTCUSDT', 101);  // adverse (against short) 0.5R
    ledger.recordMark('BTCUSDT', 97);   // favorable 1.5R
    ledger.recordClosed('short-1', 10);
    const o = ledger.outcomes[0]!;
    expect(o.maxAdverseR).toBeCloseTo(0.5, 6);
    expect(o.maxFavorableR).toBeCloseTo(1.5, 6);
  });

  it('ignores closes for unknown decisionIds (orphans never fabricate outcomes)', () => {
    const ledger = new TradeLedger();
    expect(ledger.recordClosed('ghost', 50)).toBeUndefined();
    expect(ledger.outcomes).toHaveLength(0);
  });

  it('persists events and fully rebuilds from the event log', () => {
    const store = tempStore();
    const a = new TradeLedger(store);
    a.recordOpened(snapshot({ decisionId: 'd1' }));
    a.recordOpened(snapshot({ decisionId: 'd2', strategyId: 'SWEEP_RECLAIM', regime: 'RANGE' }));
    a.recordMark('BTCUSDT', 99);
    a.recordClosed('d1', -20);
    a.recordClosed('d2', 60);

    const b = new TradeLedger(store);
    b.hydrate();
    expect(b.outcomes).toHaveLength(2);
    const d2 = b.outcomes.find((o) => o.decisionId === 'd2')!;
    expect(d2.strategyId).toBe('SWEEP_RECLAIM');
    expect(d2.regime).toBe('RANGE');
    expect(d2.rMultiple).toBeCloseTo(3, 6);
    expect(b.openTrades).toHaveLength(0);
  });

  it('groups by cell (setup x regime)', () => {
    const ledger = new TradeLedger();
    ledger.recordOpened(snapshot({ decisionId: 'a', strategyId: 'S1', regime: 'TREND_UP' }));
    ledger.recordOpened(snapshot({ decisionId: 'b', strategyId: 'S1', regime: 'RANGE' }));
    ledger.recordOpened(snapshot({ decisionId: 'c', strategyId: 'S2', regime: 'TREND_UP' }));
    ledger.recordClosed('a', 10);
    ledger.recordClosed('b', 10);
    ledger.recordClosed('c', 10);
    expect(ledger.outcomesForCell(cellOf({ strategyId: 'S1', regime: 'TREND_UP' }))).toHaveLength(1);
    expect(ledger.outcomesForCell('S1|RANGE')).toHaveLength(1);
    expect(ledger.outcomesForCell('S1|NOPE')).toHaveLength(0);
  });
});

describe('Cell statistics — expectancy, dispersion, significance', () => {
  it('computes expectancy/win-rate/profit-factor for a cell', () => {
    const mk = (id: string, r: number) => ({
      decisionId: id, symbol: 'X', strategyId: 'S', direction: 'LONG' as const,
      entry: 100, stopLoss: 98, takeProfit: 106, plannedRr: 3, regime: 'TREND_UP',
      fundingRate: 0, leverage: 3, riskAmount: 10, notional: 100, confidence: 0.5,
      openedAt: 0, pnl: r * 10, rMultiple: r, holdingMinutes: 5,
      maxAdverseR: 0.2, maxFavorableR: 1.4, closedAt: 1,
    });
    const stats = computeCellStatistics('S|TREND_UP', [
      mk('t1', 2), mk('t2', -1), mk('t3', 2), mk('t4', -1), mk('t5', 2),
    ]);
    expect(stats.n).toBe(5);
    expect(stats.expectancyR).toBeCloseTo(0.8, 6);
    expect(stats.winRate).toBeCloseTo(0.6, 6);
    expect(stats.profitFactor).toBeCloseTo(6 / 2, 6);
    expect(stats.stdDevR).toBeGreaterThan(0);
    expect(stats.tStat).toBeGreaterThan(0);
    expect(stats.worstR).toBeCloseTo(-1, 6);
    expect(stats.bestR).toBeCloseTo(2, 6);
  });

  it('returns zeroed stats for an empty cell without crashing', () => {
    const stats = computeCellStatistics('S|EMPTY', []);
    expect(stats.n).toBe(0);
    expect(stats.expectancyR).toBe(0);
    expect(stats.tStat).toBe(0);
  });

  it('splits outcomes into per-cell statistics', () => {
    const ledger = new TradeLedger();
    ledger.recordOpened(snapshot({ decisionId: 'a', strategyId: 'S1', regime: 'TREND_UP' }));
    ledger.recordOpened(snapshot({ decisionId: 'b', strategyId: 'S1', regime: 'RANGE' }));
    ledger.recordClosed('a', 40); // riskAmount 20 -> +2R
    ledger.recordClosed('b', -10); // riskAmount 20 -> -0.5R
    const cells = allCellStatistics(ledger.outcomes);
    expect(cells).toHaveLength(2);
    const up = cells.find((c) => c.cell === 'S1|TREND_UP')!;
    expect(up.expectancyR).toBeCloseTo(2, 6);
  });
});

describe('StrategyRegistry — pre-registered, statistically-gated promotion', () => {
  it('registers candidates with a frozen gate', () => {
    const registry = new StrategyRegistry();
    const def = registry.register('MOMO_BREAKOUT', { minTrades: 3, minExpectancyR: 0.5 });
    expect(def.status).toBe('CANDIDATE');
    expect(def.gate.minTrades).toBe(3);
    expect(def.gate.minExpectancyR).toBe(0.5);
    expect(def.gate.minTStat).toBe(2.0); // default preserved
  });

  it('rejects promotion when the cell does not meet the gate', () => {
    const registry = new StrategyRegistry();
    registry.register('S1', { minTrades: 5, minExpectancyR: 0.5, minWinRate: 0.6, minTStat: 2, maxWorstR: -1 });
    const stats = computeCellStatistics('S1|TREND_UP', []);
    const verdict = registry.evaluateAgainstGate('S1', 'S1|TREND_UP', stats);
    expect(verdict.promoted).toBe(false);
    expect(verdict.reasons.length).toBeGreaterThan(0);
  });

  it('promotes only a passing cell and records the decision', () => {
    const store = tempStore();
    const registry = new StrategyRegistry(store);
    registry.register('S1', { minTrades: 3, minExpectancyR: 0.5, minWinRate: 0.5, minTStat: 1, maxWorstR: -2 });
    // 3 trades: +2R, +2R, +2R -> expectancy 2, win rate 1, t high
    const mk = (id: string) => ({
      decisionId: id, symbol: 'X', strategyId: 'S1', direction: 'LONG' as const,
      entry: 100, stopLoss: 98, takeProfit: 106, plannedRr: 3, regime: 'TREND_UP',
      fundingRate: 0, leverage: 3, riskAmount: 10, notional: 100, confidence: 0.5,
      openedAt: 0, pnl: 20, rMultiple: 2, holdingMinutes: 5,
      maxAdverseR: 0.1, maxFavorableR: 2, closedAt: 1,
    });
    const stats = computeCellStatistics('S1|TREND_UP', [mk('a'), mk('b'), mk('c')]);
    const verdict = registry.promote('S1', 'S1|TREND_UP', stats);
    expect(verdict.promoted).toBe(true);
    expect(registry.get('S1')?.status).toBe('ACTIVE');

    const replay = new StrategyRegistry(store);
    replay.hydrate();
    expect(replay.get('S1')?.status).toBe('ACTIVE');
  });

  it('never promotes an unregistered or retired strategy', () => {
    const registry = new StrategyRegistry();
    const stats = computeCellStatistics('GHOST|X', []);
    expect(registry.evaluateAgainstGate('GHOST', 'GHOST|X', stats).promoted).toBe(false);
    registry.register('R1');
    registry.retire('R1', 'drift detected');
    expect(registry.evaluateAgainstGate('R1', 'R1|X', stats).promoted).toBe(false);
    expect(registry.get('R1')?.status).toBe('RETIRED');
  });

  it('re-registration bumps the version and resets to CANDIDATE', () => {
    const registry = new StrategyRegistry();
    registry.register('S1');
    registry.retire('S1', 'old');
    const v2 = registry.register('S1');
    expect(v2.version).toBe(2);
    expect(v2.status).toBe('CANDIDATE');
  });
});
