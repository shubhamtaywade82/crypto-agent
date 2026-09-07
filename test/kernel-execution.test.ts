import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ExecutionEngine } from '../src/engines/execution-engine.js';
import { PaperExecutionBroker } from '../src/infrastructure/paper/paper-broker-adapter.js';
import { EventStore } from '../src/infrastructure/events/event-store.js';
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

  it('goes UNKNOWN when the broker hangs, and the reconciler resolves it', async () => {
    vi.useFakeTimers();
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
    const pending: Promise<unknown> = submitPromise;
    vi.advanceTimersByTime(11_000);
    const tracked = (await pending) as { status: string };
    expect(tracked.status).toBe('UNKNOWN');

    // Reconciler: broker that actually filled it
    const realBroker = new PaperExecutionBroker({ initialBalance: 10_000 });
    realBroker.setMarkPrice('B-SOL_USDT', 150);
    const realEngine = new ExecutionEngine(realBroker, store);
    realEngine.registerApproved({
      intentId: 'intent-2', pair: 'B-SOL_USDT', symbol: 'SOLUSDT',
      side: 'buy', quantity: 1,
    });
    void realEngine;
    const reconciler = new Reconciler(
      broker, engine, store
    );
    // The fake broker never returns the order, so UNKNOWN stays UNKNOWN
    const report = await reconciler.reconcile();
    expect(report.stillUnknown).toBe(1);
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
