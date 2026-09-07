import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ExecutionEngine } from '../src/engines/execution-engine.js';
import { PaperExecutionBroker } from '../src/infrastructure/paper/paper-broker-adapter.js';
import { EventStore, EventPersistenceError } from '../src/infrastructure/events/event-store.js';
import { Reconciler } from '../src/engines/reconciler.js';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const makeStore = (): EventStore =>
  new EventStore(join(mkdtempSync(join(tmpdir(), 'ev-')), 'events.jsonl'));

describe('ExecutionEngine + Reconciler (paper venue)', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  const makeEngine = () => {
    const broker = new PaperExecutionBroker({ initialBalance: 10_000 });
    broker.setMarkPrice('B-SOL_USDT', 150);
    const store = makeStore();
    const engine = new ExecutionEngine(broker, store);
    return { broker, store, engine };
  };

  it('walks RISK_APPROVED -> FILLED on the happy path', async () => {
    const { engine } = makeEngine();
    engine.registerApproved({
      intentId: 'intent-1', pair: 'B-SOL_USDT', symbol: 'SOLUSDT',
      side: 'buy', quantity: 1,
    });
    const tracked = await engine.submit('intent-1', {
      pair: 'B-SOL_USDT', side: 'buy', orderType: 'market_order',
      quantity: 1, leverage: 2, marginType: 'isolated',
    });
    expect(tracked.status).toBe('FILLED');
    expect(tracked.filledQuantity).toBe(1);
    expect(tracked.avgFillPrice).toBeGreaterThan(150); // slippage on buy
  });

  it('records the true from -> to states in the audit trail', async () => {
    const { store, engine } = makeEngine();
    engine.registerApproved({
      intentId: 'audit-1', pair: 'B-SOL_USDT', symbol: 'SOLUSDT',
      side: 'buy', quantity: 1,
    });
    await engine.submit('audit-1', {
      pair: 'B-SOL_USDT', side: 'buy', orderType: 'market_order',
      quantity: 1, leverage: 2, marginType: 'isolated',
    });
    const transitions = store.readAll(100)
      .filter((e) => e.type === 'order.transition')
      .map((e) => e.payload as { from: string; to: string });
    expect(transitions.length).toBeGreaterThanOrEqual(2);
    // Every event must be a genuine transition, never from === to.
    for (const t of transitions) {
      expect(t.from).not.toBe(t.to);
    }
    expect(transitions[0]).toMatchObject({ from: 'RISK_APPROVED', to: 'SUBMITTING' });
    expect(transitions[transitions.length - 1]).toMatchObject({ to: 'FILLED' });
  });

  it('goes UNKNOWN when the broker hangs, and NOT_FOUND resolves it via missing-order policy', async () => {
    const broker = new PaperExecutionBroker({ initialBalance: 10_000 });
    broker.setMarkPrice('B-SOL_USDT', 150);
    const hanging = { ...broker };
    (hanging as unknown as { placeOrder: () => Promise<never> }).placeOrder =
      () => new Promise(() => undefined); // never resolves
    const store = makeStore();
    const engine = new ExecutionEngine(hanging as unknown as PaperExecutionBroker, store);
    engine.registerApproved({
      intentId: 'intent-2', pair: 'B-SOL_USDT', symbol: 'SOLUSDT',
      side: 'buy', quantity: 1,
    });
    const submitPromise = engine.submit('intent-2', {
      pair: 'B-SOL_USDT', side: 'buy', orderType: 'market_order',
      quantity: 1, leverage: 2, marginType: 'isolated',
    });
    vi.advanceTimersByTime(11_000);
    const tracked = (await submitPromise) as { status: string };
    expect(tracked.status).toBe('UNKNOWN');

    // The venue affirmatively reports no such order and no position:
    // missing-order policy -> CANCELLED (no longer stuck in UNKNOWN).
    const reconciler = new Reconciler(broker, engine, store);
    const report = await reconciler.reconcile();
    expect(report.repaired).toBe(1);
    expect(engine.get('intent-2')?.status).toBe('CANCELLED');
  });

  it('LOOKUP_FAILED never resolves or cancels: UNKNOWN stays UNKNOWN', async () => {
    const broker = new PaperExecutionBroker({ initialBalance: 10_000 });
    broker.setMarkPrice('B-SOL_USDT', 150);
    const store = makeStore();
    const engine = new ExecutionEngine(broker, store);
    engine.registerApproved({
      intentId: 'intent-fx', pair: 'B-SOL_USDT', symbol: 'SOLUSDT',
      side: 'buy', quantity: 1,
    });
    engine.transition(engine.get('intent-fx')!, 'SUBMITTING');
    engine.transition(engine.get('intent-fx')!, 'UNKNOWN');

    // Venue outage: lookups fail (the dangerous case the old reconciler
    // misread as "missing order" and cancelled).
    const failing = {
      lookupOrder: async () => ({ kind: 'LOOKUP_FAILED', reason: 'HTTP 503' }),
      getPositions: async () => { throw new Error('HTTP 503'); },
    };
    const reconciler = new Reconciler(
      failing as unknown as PaperExecutionBroker, engine, store
    );
    const report = await reconciler.reconcile();
    expect(report.lookupFailed).toBe(1);
    expect(report.stillUnknown).toBe(1);
    expect(engine.get('intent-fx')?.status).toBe('UNKNOWN');
  });

  it('LOOKUP_FAILED holds a live SUBMITTED order instead of cancelling it', async () => {
    const { broker, store, engine } = makeEngine();
    engine.registerApproved({
      intentId: 'intent-live', pair: 'B-SOL_USDT', symbol: 'SOLUSDT',
      side: 'buy', quantity: 1,
    });
    await engine.submit('intent-live', {
      pair: 'B-SOL_USDT', side: 'buy', orderType: 'limit_order',
      quantity: 1, price: 100, leverage: 2, marginType: 'isolated',
    });
    expect(engine.get('intent-live')?.status).toBe('SUBMITTED');

    const failing = {
      lookupOrder: async () => ({ kind: 'LOOKUP_FAILED', reason: 'rate limited' }),
      getPositions: async () => [],
    };
    const reconciler = new Reconciler(failing as unknown as PaperExecutionBroker, engine, store);
    const report = await reconciler.reconcile();
    expect(report.lookupFailed).toBe(1);
    expect(report.repaired).toBe(0);
    expect(engine.get('intent-live')?.status).toBe('SUBMITTED');
  });

  it('a FOUND fill with live position evidence advances to POSITION_OPEN', async () => {
    const broker = new PaperExecutionBroker({ initialBalance: 10_000 });
    broker.setMarkPrice('B-SOL_USDT', 150);
    const store = makeStore();
    const engine = new ExecutionEngine(broker, store);
    engine.registerApproved({
      intentId: 'intent-fill', pair: 'B-SOL_USDT', symbol: 'SOLUSDT',
      side: 'buy', quantity: 1,
    });
    engine.transition(engine.get('intent-fill')!, 'SUBMITTING');
    engine.transition(engine.get('intent-fill')!, 'UNKNOWN');

    // Venue truth: the order actually FILLED and a live position exists.
    const venueTruth = {
      lookupOrder: async () => ({
        kind: 'FOUND' as const,
        order: {
          orderId: 'v1', clientOrderId: 'intent-fill', pair: 'B-SOL_USDT',
          status: 'FILLED' as const, filledQuantity: 1, avgFillPrice: 150.5,
        },
      }),
      getPositions: async () => [{
        positionId: 'p1', pair: 'B-SOL_USDT', side: 'long' as const,
        size: 1, entryPrice: 150.5, markPrice: 151, leverage: 2,
        unrealizedPnl: 0.5,
      }],
    };
    const reconciler = new Reconciler(
      venueTruth as unknown as PaperExecutionBroker, engine, store
    );
    const report = await reconciler.reconcile();
    expect(report.resolved).toBeGreaterThanOrEqual(1);
    expect(engine.get('intent-fill')?.status).toBe('POSITION_OPEN');
  });

  it('blocks submission when the durable event store is unhealthy', async () => {
    const broker = new PaperExecutionBroker({ initialBalance: 10_000 });
    broker.setMarkPrice('B-SOL_USDT', 150);
    // Durable store pointed at an unwritable target: an existing directory
    // as the file path fails every append instantly with EISDIR.
    const unwritable = mkdtempSync(join(tmpdir(), 'evro-'));
    const store = new EventStore({ filePath: unwritable, durable: true });
    const engine = new ExecutionEngine(broker, store);
    // Durability contract fails LOUDLY at registration: the audit trail
    // for a new order intent cannot be persisted, so the intent is
    // refused outright instead of trading without an audit backbone.
    expect(() =>
      engine.registerApproved({
        intentId: 'intent-dur', pair: 'B-SOL_USDT', symbol: 'SOLUSDT',
        side: 'buy', quantity: 1,
      })
    ).toThrow(EventPersistenceError);
    expect(store.healthy).toBe(false);

    // And the submit guard: an order registered while the store was
    // healthy must be refused the moment the store degrades.
    const healthyStore = makeStore();
    const engine2 = new ExecutionEngine(broker, healthyStore);
    engine2.registerApproved({
      intentId: 'intent-dur2', pair: 'B-SOL_USDT', symbol: 'SOLUSDT',
      side: 'buy', quantity: 1,
    });
    Object.defineProperty(healthyStore, 'healthy', { get: () => false });
    await expect(engine2.submit('intent-dur2', {
      pair: 'B-SOL_USDT', side: 'buy', orderType: 'market_order',
      quantity: 1, leverage: 2, marginType: 'isolated',
    })).rejects.toThrow(/event store unhealthy/);
    expect(engine2.get('intent-dur2')?.status).toBe('RISK_APPROVED');
  });

  it('cancels a tracked order through the broker', async () => {
    const { engine } = makeEngine();
    engine.registerApproved({
      intentId: 'intent-3', pair: 'B-SOL_USDT', symbol: 'SOLUSDT',
      side: 'buy', quantity: 1,
    });
    await engine.submit('intent-3', {
      pair: 'B-SOL_USDT', side: 'buy', orderType: 'limit_order',
      quantity: 1, price: 100, leverage: 2, marginType: 'isolated',
    });
    await engine.cancel('intent-3');
    expect(engine.get('intent-3')?.status).toBe('CANCELLED');
  });

  it('listOpen excludes terminal states', async () => {
    const { engine } = makeEngine();
    engine.registerApproved({
      intentId: 'intent-4', pair: 'B-SOL_USDT', symbol: 'SOLUSDT',
      side: 'buy', quantity: 1,
    });
    await engine.submit('intent-4', {
      pair: 'B-SOL_USDT', side: 'buy', orderType: 'market_order',
      quantity: 1, leverage: 2, marginType: 'isolated',
    });
    expect(engine.listOpen().map((o) => o.intentId)).toContain('intent-4');
  });
});
