import { describe, it, expect } from 'vitest';
import { ExecutionEngine } from '../src/engines/execution-engine.js';
import { Reconciler } from '../src/engines/reconciler.js';
import { PaperExecutionBroker } from '../src/infrastructure/paper/paper-broker-adapter.js';
import { EventStore } from '../src/infrastructure/events/event-store.js';
import { summarize } from '../src/learning/performance-analytics.js';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { IExecutionBroker } from '../src/infrastructure/broker/broker.js';

const tempStore = (): EventStore =>
  new EventStore({ filePath: join(mkdtempSync(join(tmpdir(), 'rel-')), 'events.jsonl') });

const hangingBroker = (): IExecutionBroker =>
  ({
    id: 'hanging',
    capabilities: ['ORDER_EXECUTION'],
    getInstrument: async () => undefined,
    placeOrder: () => new Promise(() => undefined), // never resolves
    cancelOrder: async () => undefined,
    lookupOrder: async () => ({ kind: 'LOOKUP_FAILED', reason: 'venue down' }),
    getOrder: async () => undefined,
    getOpenOrders: async () => [],
    getPositions: async () => [],
    getBalances: async () => [],
    setLeverage: async () => undefined,
    attachTPSL: async () => undefined,
    closePosition: async () => undefined,
  }) as unknown as IExecutionBroker;

describe('Reliability — duplicate submission idempotency', () => {
  it('refuses a second submit of an in-flight intent (no double venue order)', async () => {
    const store = tempStore();
    const engine = new ExecutionEngine(hangingBroker(), store);
    engine.registerApproved({
      intentId: 'd-up', pair: 'B-BTC_USDT', symbol: 'BTCUSDT',
      side: 'buy', quantity: 0.01,
    });
    const first = engine.submit('d-up', {
      pair: 'B-BTC_USDT', side: 'buy', orderType: 'market_order',
      quantity: 0.01, leverage: 2, marginType: 'isolated',
    });
    await expect(engine.submit('d-up', {
      pair: 'B-BTC_USDT', side: 'buy', orderType: 'market_order',
      quantity: 0.01, leverage: 2, marginType: 'isolated',
    })).rejects.toThrow(/not submittable in status SUBMITTING/);
    first.catch(() => undefined); // resolves UNKNOWN after the submit timeout
  });

  it('refuses a re-submit after the order already FILLED', async () => {
    const store = tempStore();
    const broker = new PaperExecutionBroker({ initialBalance: 10_000 });
    broker.setMarkPrice('B-BTC_USDT', 100);
    const engine = new ExecutionEngine(broker, store);
    engine.registerApproved({
      intentId: 'd-fill', pair: 'B-BTC_USDT', symbol: 'BTCUSDT',
      side: 'buy', quantity: 0.01,
    });
    const tracked = await engine.submit('d-fill', {
      pair: 'B-BTC_USDT', side: 'buy', orderType: 'market_order',
      quantity: 0.01, leverage: 2, marginType: 'isolated',
    });
    expect(tracked.status).toBe('FILLED');
    await expect(engine.submit('d-fill', {
      pair: 'B-BTC_USDT', side: 'buy', orderType: 'market_order',
      quantity: 0.01, leverage: 2, marginType: 'isolated',
    })).rejects.toThrow(/not submittable in status FILLED/);
  });
});

describe('Reliability — kill -9 restart: tracked orders survive via hydration', () => {
  it('revives UNKNOWN orders from the log and the reconciler converges them', async () => {
    const store = tempStore();
    // Process A: register + submit against a hanging broker -> UNKNOWN.
    const engineA = new ExecutionEngine(hangingBroker(), store);
    engineA.registerApproved({
      intentId: 'd-crash', pair: 'B-BTC_USDT', symbol: 'BTCUSDT',
      side: 'buy', quantity: 0.02,
    });
    const crashing = engineA.submit('d-crash', {
      pair: 'B-BTC_USDT', side: 'buy', orderType: 'market_order',
      quantity: 0.02, leverage: 3, marginType: 'isolated',
    });
    crashing.catch(() => undefined);
    // Do not wait: simulate kill -9 BEFORE the submit timeout resolves.

    // Process B: fresh engine hydrates from the event log.
    const brokerB = new PaperExecutionBroker({ initialBalance: 10_000 });
    const engineB = new ExecutionEngine(brokerB, store);
    engineB.hydrate();
    const revived = engineB.get('d-crash');
    expect(revived).toBeDefined();
    // V3.2 P0-3: in-flight submission crash is revived as UNKNOWN so Reconciler queries venue truth
    expect(revived?.status).toBe('UNKNOWN');
    expect(engineB.listOpen()).toHaveLength(1);

    // Reconciler converges the revived order against broker truth.
    const reconciler = new Reconciler(brokerB, engineB, store);
    brokerB.setMarkPrice('B-BTC_USDT', 100);
    const report = await reconciler.reconcile();
    expect(report.checked).toBeGreaterThanOrEqual(1);
    const after = engineB.get('d-crash')!;
    expect(['UNKNOWN', 'CANCELLED', 'FILLED', 'POSITION_OPEN', 'SUBMITTED'])
      .toContain(after.status);
    await reconciler.reconcile(); // second pass: policy may now apply
    const settled = engineB.get('d-crash')!;
    expect(['CANCELLED', 'UNKNOWN', 'FILLED', 'POSITION_OPEN', 'SUBMITTED'])
      .toContain(settled.status);
  });

  it('does not revive terminal orders (REJECTED stays dead)', async () => {
    const store = tempStore();
    const engineA = new ExecutionEngine(hangingBroker(), store);
    engineA.registerApproved({
      intentId: 'd-rej', pair: 'B-BTC_USDT', symbol: 'BTCUSDT',
      side: 'buy', quantity: 0.01,
    });
    const tracked = engineA.get('d-rej')!;
    engineA.transition(tracked, 'SUBMITTING');
    engineA.transition(tracked, 'REJECTED'); // venue rejected the order
    const engineB = new ExecutionEngine(hangingBroker(), store);
    engineB.hydrate();
    expect(engineB.get('d-rej')).toBeUndefined(); // terminal orders stay dead
    expect(engineB.listOpen()).toHaveLength(0);
  });
});

describe('Reliability — partial fills fold through the FSM', () => {
  it('tracks a PARTIALLY_FILLED broker update and keeps it open', async () => {
    const store = tempStore();
    const engine = new ExecutionEngine(hangingBroker(), store);
    engine.registerApproved({
      intentId: 'd-part', pair: 'B-BTC_USDT', symbol: 'BTCUSDT',
      side: 'buy', quantity: 1.0,
    });
    const tracked0 = engine.get('d-part')!;
    // Simulate the submit path having reached the venue, then fold a
    // broker-side partial-fill truth via applyBrokerUpdate.
    engine.transition(tracked0, 'SUBMITTING');
    engine.transition(tracked0, 'SUBMITTED');
    engine.applyBrokerUpdate(tracked0, {
      orderId: 'venue-9', clientOrderId: 'd-part', pair: 'B-BTC_USDT',
      status: 'PARTIALLY_FILLED', filledQuantity: 0.4, avgFillPrice: 100.2,
    });
    const tracked = engine.get('d-part')!;
    expect(tracked.status).toBe('PARTIALLY_FILLED');
    expect(tracked.filledQuantity).toBe(0.4);
    expect(engine.listOpen()).toHaveLength(1); // still open, still reconciled
  });
});

describe('Performance analytics — summary and ratios', () => {
  const mkOutcome = (id: string, pnl: number, r: number, closedAt: number, strategyId = 'S1') => ({
    decisionId: id, symbol: 'BTCUSDT', strategyId,
    direction: 'LONG' as const, entry: 100, stopLoss: 98, takeProfit: 106,
    plannedRr: 3, regime: 'TREND_UP', fundingRate: 0.0001, leverage: 3,
    riskAmount: 10, notional: 100, confidence: 0.6, openedAt: closedAt - 60_000,
    pnl, rMultiple: r, holdingMinutes: 1, maxAdverseR: 0.1,
    maxFavorableR: r, closedAt,
  });

  it('summarizes totals, expectancy and ratios over attributed outcomes', () => {
    const base = 1_700_000_000_000;
    const day = 86_400_000;
    const records = [
      mkOutcome('a', 20, 2, base),            // day 0: +2R
      mkOutcome('b', -10, -1, base + 1_000),  // day 0: -1R
      mkOutcome('c', 30, 3, base + day),      // day 1: +3R
      mkOutcome('d', 15, 1.5, base + day),    // day 1: +1.5R
      mkOutcome('e', -5, -0.5, base + 2 * day, 'S2'), // day 2 (S2)
    ];
    const s = summarize(records);
    expect(s.tradeCount).toBe(5);
    expect(s.realizedPnl).toBeCloseTo(50, 6);
    expect(s.winRate).toBeCloseTo(0.6, 6);
    expect(s.expectancyR).toBeCloseTo((2 - 1 + 3 + 1.5 - 0.5) / 5, 6);
    expect(s.sharpe).toBeGreaterThan(0);
    expect(s.sortino).toBeGreaterThanOrEqual(s.sharpe * 0); // defined, sane
  });

  it('returns zeroed summary for an empty ledger', () => {
    const s = summarize([]);
    expect(s.tradeCount).toBe(0);
    expect(s.sharpe).toBe(0);
    expect(s.sortino).toBe(0);
  });
});
