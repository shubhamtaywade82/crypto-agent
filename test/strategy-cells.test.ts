import { describe, it, expect } from 'vitest';
import { StrategyRegistry, DEFAULT_GATE, checkGate } from '../src/learning/strategy-registry.js';
import { EventStore } from '../src/infrastructure/events/event-store.js';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { CellStatistics } from '../src/learning/statistics.js';

const tempStore = (): EventStore =>
  new EventStore({ filePath: join(mkdtempSync(join(tmpdir(), 'reg-')), 'events.jsonl') });

const stats = (over: Partial<CellStatistics>): CellStatistics => ({
  cell: 'S1|TREND_UP', n: 40, expectancyR: 0.25, winRate: 0.5, profitFactor: 1.6,
  stdDevR: 0.8, tStat: 2.2, worstR: -1.5, bestR: 3,
  meanMaxAdverseR: 0.4, meanMaxFavorableR: 1.2, ...over,
});

describe('StrategyRegistry — approved cells (V3.1 P0-5)', () => {
  it('isCellTradable requires ACTIVE status AND an approved cell', () => {
    const registry = new StrategyRegistry();
    registry.register('S1');
    // CANDIDATE: not tradable even with matching cell.
    expect(registry.isCellTradable('S1', 'S1', 'TREND_UP').allowed).toBe(false);
    registry.promote('S1', 'S1|TREND_UP', stats({ cell: 'S1|TREND_UP' }));
    expect(registry.isCellTradable('S1', 'S1', 'TREND_UP').allowed).toBe(true);
    // ACTIVE but different regime -> not approved.
    expect(registry.isCellTradable('S1', 'S1', 'RANGE').allowed).toBe(false);
    expect(registry.get('S1')!.approvedCells).toEqual(['S1|TREND_UP']);
  });

  it('unregistered strategies are never tradable once the registry is non-empty', () => {
    const registry = new StrategyRegistry();
    registry.register('S1');
    const verdict = registry.isCellTradable('GHOST', 'GHOST', 'TREND_UP');
    expect(verdict.allowed).toBe(false);
    expect(verdict.reason).toMatch(/not registered/);
  });

  it('promoted cells survive restart through the event journal', () => {
    const store = tempStore();
    const registry = new StrategyRegistry(store);
    registry.register('S1');
    registry.promote('S1', 'S1|TREND_UP', stats({ cell: 'S1|TREND_UP' }));
    registry.promote('S1', 'S1|RANGE', stats({ cell: 'S1|RANGE' }));
    const reborn = new StrategyRegistry(store);
    reborn.hydrate();
    expect(reborn.get('S1')!.status).toBe('ACTIVE');
    expect(reborn.get('S1')!.approvedCells).toEqual(['S1|TREND_UP', 'S1|RANGE']);
    expect(reborn.isCellTradable('S1', 'S1', 'RANGE').allowed).toBe(true);
  });

  it('registerOnce is idempotent (does not bump the version)', () => {
    const registry = new StrategyRegistry();
    const a = registry.registerOnce('S1');
    const b = registry.registerOnce('S1');
    expect(b.version).toBe(a.version);
  });
});

describe('Frozen gate — the promotion contract', () => {
  it('DEFAULT_GATE thresholds are exactly the frozen research contract', () => {
    expect(DEFAULT_GATE).toEqual({
      minTrades: 30, minExpectancyR: 0.15, minWinRate: 0.4, minTStat: 2.0, maxWorstR: -3.0,
    });
  });

  it('checkGate reports each failing dimension with explicit reasons', () => {
    const verdict = checkGate(stats({
      cell: 'X', n: 10, expectancyR: 0.05, winRate: 0.3, tStat: 0.5, worstR: -4,
    }), DEFAULT_GATE);
    expect(verdict.promoted).toBe(false);
    expect(verdict.reasons.length).toBeGreaterThanOrEqual(4);
  });
});
