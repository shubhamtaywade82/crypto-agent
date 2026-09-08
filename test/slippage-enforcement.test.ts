import { describe, it, expect } from 'vitest';
import { ExecutionEngine } from '../src/engines/execution-engine.js';
import { EventStore } from '../src/infrastructure/events/event-store.js';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { IExecutionBroker } from '../src/infrastructure/broker/broker.js';

const tempStore = (): EventStore =>
  new EventStore({ filePath: join(mkdtempSync(join(tmpdir(), 'slip-')), 'events.jsonl') });

/**
 * Broker that folds scripted broker views back through applyBrokerUpdate
 * on submit (simulating partial fills arriving from the venue).
 */
const scriptedBroker = (
  views: { status: 'PARTIALLY_FILLED' | 'FILLED'; filledQuantity: number; avgFillPrice: number }[]
): IExecutionBroker =>
  ({
    id: 'test',
    capabilities: ['ORDER_EXECUTION'],
    placeOrder: async (): Promise<unknown> => views[0],
    cancelOrder: async (): Promise<void> => undefined,
  }) as unknown as IExecutionBroker;

const submitAndFold = async (
  engine: ExecutionEngine,
  views: Parameters<typeof scriptedBroker>[0],
  opts: { expectedPrice: number; maxSlippageBps?: number }
): Promise<void> => {
  engine.registerApproved({
    intentId: 'd-1', pair: 'B-BTC_USDT', symbol: 'BTCUSDT', side: 'buy', quantity: 1,
  });
  // Wrap applyBrokerUpdate to replay the scripted sequence.
  const original = engine.applyBrokerUpdate.bind(engine);
  let step = 0;
  engine.applyBrokerUpdate = (tracked, update): void => {
    const view = views[Math.min(step, views.length - 1)];
    step += 1;
    original(tracked, { orderId: 'v-1', ...view } as typeof update);
  };
  await engine.submit('d-1', {
    pair: 'B-BTC_USDT', side: 'buy', orderType: 'market_order', quantity: 1,
    leverage: 1, marginType: 'isolated', ...opts,
  });
};

describe('ExecutionEngine — deterministic slippage enforcement (V3.1 P0-1)', () => {
  it('within the band: no breach event, no cancellation', async () => {
    const store = tempStore();
    const engine = new ExecutionEngine(
      scriptedBroker([{ status: 'FILLED', filledQuantity: 1, avgFillPrice: 100.1 }]), store
    );
    await submitAndFold(engine,
      [{ status: 'FILLED', filledQuantity: 1, avgFillPrice: 100.1 }],
      { expectedPrice: 100, maxSlippageBps: 25 });
    const tracked = engine.get('d-1')!;
    expect(tracked.slippageBreach).toBeUndefined();
    expect(store.readAll(100).map((e) => e.type)).not.toContain('execution.slippage_breach');
  });

  it('fill beyond the band: CRITICAL breach event recorded on the order', async () => {
    const store = tempStore();
    // Fill 1% above expected with a 25 bps band -> 100 bps breach.
    const engine = new ExecutionEngine(
      scriptedBroker([{ status: 'FILLED', filledQuantity: 1, avgFillPrice: 101 }]), store
    );
    await submitAndFold(engine,
      [{ status: 'FILLED', filledQuantity: 1, avgFillPrice: 101 }],
      { expectedPrice: 100, maxSlippageBps: 25 });
    const tracked = engine.get('d-1')!;
    expect(tracked.slippageBreach).toBeDefined();
    expect(tracked.slippageBreach!.slippageBps).toBeCloseTo(100, 4);
    expect(tracked.slippageBreach!.fillPrice).toBeCloseTo(101, 6);
    expect(store.readAll(100).map((e) => e.type)).toContain('execution.slippage_breach');
  });

  it('partial fill beyond the band cancels the un-filled remainder', async () => {
    const store = tempStore();
    const engine = new ExecutionEngine(
      scriptedBroker([
        { status: 'PARTIALLY_FILLED', filledQuantity: 0.5, avgFillPrice: 102 },
      ]), store
    );
    engine.registerApproved({
      intentId: 'd-1', pair: 'B-BTC_USDT', symbol: 'BTCUSDT', side: 'buy', quantity: 1,
    });
    const original = engine.applyBrokerUpdate.bind(engine);
    engine.applyBrokerUpdate = (tracked, update): void => {
      original(tracked, { orderId: 'v-1', status: 'PARTIALLY_FILLED', filledQuantity: 0.5, avgFillPrice: 102 });
    };
    await engine.submit('d-1', {
      pair: 'B-BTC_USDT', side: 'buy', orderType: 'market_order', quantity: 1,
      leverage: 1, marginType: 'isolated', expectedPrice: 100, maxSlippageBps: 50,
    });
    // Await the fire-and-forget remainder cancel.
    await new Promise((r) => setTimeout(r, 20));
    const tracked = engine.get('d-1')!;
    expect(tracked.slippageBreach).toBeDefined(); // 200 bps > 50 bps band
    expect(tracked.status).toBe('CANCELLED');
    expect(store.readAll(100).map((e) => e.type)).toContain('execution.slippage_breach');
  });

  it('marginal (not cumulative) pricing: only the breaching delta is flagged', () => {
    // 0.5 @ 100 (fine) then avg 105 with 1.0 total -> marginal 110.
    const engine = new ExecutionEngine(scriptedBroker([]), tempStore());
    engine.registerApproved({
      intentId: 'd-2', pair: 'B-BTC_USDT', symbol: 'BTCUSDT', side: 'buy', quantity: 2,
    });
    const tracked = engine.get('d-2')!;
    engine.transition(tracked, 'SUBMITTING');
    tracked.expectedPrice = 100;
    tracked.maxSlippageBps = 25;
    engine.applyBrokerUpdate(tracked, {
      orderId: 'v-2', status: 'PARTIALLY_FILLED', filledQuantity: 0.5, avgFillPrice: 100,
    } as never);
    expect(tracked.slippageBreach).toBeUndefined();
    engine.applyBrokerUpdate(tracked, {
      orderId: 'v-2', status: 'PARTIALLY_FILLED', filledQuantity: 1.0, avgFillPrice: 105,
    } as never);
    // Marginal fill = (105*1.0 - 100*0.5)/0.5 = 110 -> +1000 bps.
    expect(tracked.slippageBreach).toBeDefined();
    expect(tracked.slippageBreach!.fillPrice).toBeCloseTo(110, 6);
  });

  it('contract guard: maxSlippageBps without expectedPrice is refused', async () => {
    const engine = new ExecutionEngine(scriptedBroker([]), tempStore());
    engine.registerApproved({
      intentId: 'd-3', pair: 'B-BTC_USDT', symbol: 'BTCUSDT', side: 'buy', quantity: 1,
    });
    await expect(engine.submit('d-3', {
      pair: 'B-BTC_USDT', side: 'buy', orderType: 'market_order', quantity: 1,
      leverage: 1, marginType: 'isolated', maxSlippageBps: 25,
    })).rejects.toThrow(/requires expectedPrice/);
  });
});
