import { describe, it, expect } from 'vitest';
import { FillsLedger, slippageBps } from '../src/engines/fills-ledger.js';
import { ExecutionEngine } from '../src/engines/execution-engine.js';
import { EventStore } from '../src/infrastructure/events/event-store.js';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { IExecutionBroker } from '../src/infrastructure/broker/broker.js';
import type { TrackedOrder } from '../src/engines/execution-engine.js';

const tempStore = (): EventStore =>
  new EventStore({ filePath: join(mkdtempSync(join(tmpdir(), 'fills-')), 'events.jsonl') });

const trackedOf = (over: Partial<TrackedOrder>): TrackedOrder =>
  ({
    intentId: 'dec-1', pair: 'B-BTC_USDT', symbol: 'BTCUSDT', side: 'buy',
    quantity: 1, reduceOnly: false, status: 'FILLED', filledQuantity: 0,
    updatedAt: 1_000, registeredAt: 900, intentType: 'ENTRY', ...over,
  }) as TrackedOrder;

describe('slippageBps — worse-than-intended is positive', () => {
  it('buys: fill above expected is positive, below is negative', () => {
    expect(slippageBps('buy', 101, 100)).toBeCloseTo(100);
    expect(slippageBps('buy', 99, 100)).toBeCloseTo(-100);
  });
  it('sells: fill below expected is positive (worse), above is negative', () => {
    expect(slippageBps('sell', 99, 100)).toBeCloseTo(100);
    expect(slippageBps('sell', 101, 100)).toBeCloseTo(-100);
  });
});

describe('FillsLedger — recording + execution quality', () => {
  it('persists fill.recorded events and computes slippage/latency', () => {
    const store = tempStore();
    const ledger = new FillsLedger(store, 'coindcx');
    ledger.record(trackedOf({ filledQuantity: 0.5, avgFillPrice: 101, expectedPrice: 100 }), 1_200);
    const quality = ledger.quality();
    expect(quality.fills).toBe(1);
    expect(quality.avgSlippageBps).toBeCloseTo(100); // bought 1% above intended
    expect(quality.avgFillLatencyMs).toBe(300);
    expect(store.readAll(50).map((e) => e.type)).toContain('fill.recorded');
  });

  it('partial fills become delta records (cumulative 0.5 -> 1.0 = one 0.5 delta)', () => {
    const store = tempStore();
    const ledger = new FillsLedger(store, 'coindcx');
    ledger.record(trackedOf({ filledQuantity: 0.5, avgFillPrice: 100 }), 1_100);
    ledger.record(trackedOf({ filledQuantity: 1.0, avgFillPrice: 102 }), 1_200);
    expect(ledger.all).toHaveLength(2);
    expect(ledger.all[0].quantity).toBeCloseTo(0.5);
    expect(ledger.all[1].quantity).toBeCloseTo(0.5);
    expect(ledger.all[1].cumulativeQuantity).toBeCloseTo(1.0);
  });

  it('hydrate replay reproduces identical metrics (no double counting)', () => {
    const store = tempStore();
    const closes: string[] = [];
    const ledger = new FillsLedger(store, 'coindcx', (id): void => {
      closes.push(id);
    });
    ledger.record(trackedOf({ intentId: 'e-1', filledQuantity: 0.5, avgFillPrice: 100, intentType: 'ENTRY' }), 1_100);
    ledger.record(trackedOf({ intentId: 'e-2', filledQuantity: 0.5, avgFillPrice: 100, intentType: 'ENTRY' }), 1_200);
    ledger.record(
      trackedOf({ intentId: 'x-1', side: 'sell', filledQuantity: 1.0, avgFillPrice: 110, intentType: 'EXIT' }), 1_300
    );
    const before = ledger.quality();
    // Fresh instance over the same event store (restart scenario).
    const reborn = new FillsLedger(store, 'coindcx', (id): void => {
      closes.push(id);
    });
    reborn.hydrate();
    expect(reborn.quality()).toEqual(before);
  });
});

describe('FillsLedger — position accounting + live PnL attribution', () => {
  it('EXIT fill realizes PnL against the average entry and attributes to the ENTRY decision', () => {
    const closes: { decisionId: string; pnl: number }[] = [];
    const ledger = new FillsLedger(
      tempStore(), 'coindcx',
      (decisionId, pnl): void => {
        closes.push({ decisionId, pnl });
      }
    );
    // Long 0.5 @ 100 then 0.5 @ 110 -> avg 105; exit all @ 120 -> pnl +15.
    ledger.record(trackedOf({ intentId: 'e-1', filledQuantity: 0.5, avgFillPrice: 100, intentType: 'ENTRY' }), 1_100);
    ledger.record(trackedOf({ intentId: 'e-2', filledQuantity: 0.5, avgFillPrice: 110, intentType: 'ENTRY' }), 1_200);
    ledger.record(
      trackedOf({ intentId: 'x-1', side: 'sell', filledQuantity: 1.0, avgFillPrice: 120, intentType: 'EXIT' }), 1_300
    );
    expect(closes).toHaveLength(1);
    expect(closes[0].decisionId).toBe('e-1'); // the ENTRY decision
    expect(closes[0].pnl).toBeCloseTo(15, 6);
    expect(ledger.quality().realizedPnl).toBeCloseTo(15, 6);
    expect(ledger.quality().realizedTrades).toBe(1);
  });

  it('short positions: exit below entry realizes profit', () => {
    const closes: number[] = [];
    const ledger = new FillsLedger(tempStore(), 'coindcx', (_id, pnl): void => {
      closes.push(pnl);
    });
    ledger.record(
      trackedOf({ intentId: 'e-1', side: 'sell', filledQuantity: 1, avgFillPrice: 100, intentType: 'ENTRY' }), 1_100
    );
    ledger.record(
      trackedOf({ intentId: 'x-1', side: 'buy', filledQuantity: 1, avgFillPrice: 95, intentType: 'EXIT' }), 1_200
    );
    expect(closes[0]).toBeCloseTo(5, 6);
  });

  it('reduce overfill clamps to the open quantity', () => {
    const closes: number[] = [];
    const ledger = new FillsLedger(tempStore(), 'coindcx', (_id, pnl): void => {
      closes.push(pnl);
    });
    ledger.record(trackedOf({ intentId: 'e-1', filledQuantity: 0.5, avgFillPrice: 100, intentType: 'ENTRY' }), 1_100);
    ledger.record(
      trackedOf({ intentId: 'x-1', side: 'sell', filledQuantity: 2, avgFillPrice: 110, intentType: 'REDUCE' }), 1_200
    );
    expect(closes).toHaveLength(1);
    expect(closes[0]).toBeCloseTo(5, 6); // 0.5 * (110 - 100)
  });

  it('PAPER venue does not invoke the close callback (paper broker owns it)', () => {
    const closes: number[] = [];
    const ledger = new FillsLedger(tempStore(), 'paper', (_id, pnl): void => {
      closes.push(pnl);
    });
    ledger.record(trackedOf({ intentId: 'e-1', filledQuantity: 1, avgFillPrice: 100, intentType: 'ENTRY' }), 1_100);
    ledger.record(
      trackedOf({ intentId: 'x-1', side: 'sell', filledQuantity: 1, avgFillPrice: 110, intentType: 'EXIT' }), 1_200
    );
    expect(ledger.quality().realizedTrades).toBe(1);
    expect(closes).toHaveLength(0);
  });

  it('EXIT without an open lot is recorded but not attributed', () => {
    const closes: number[] = [];
    const ledger = new FillsLedger(tempStore(), 'coindcx', (_id, pnl): void => {
      closes.push(pnl);
    });
    ledger.record(
      trackedOf({ intentId: 'x-1', side: 'sell', filledQuantity: 1, avgFillPrice: 100, intentType: 'EXIT' }), 1_100
    );
    expect(ledger.quality().fills).toBe(1);
    expect(closes).toHaveLength(0);
    expect(ledger.quality().realizedTrades).toBe(0);
  });
});

describe('ExecutionEngine fill hook — submit and reconciler paths', () => {
  const instantBroker = (fillPrice: number): IExecutionBroker =>
    ({
      id: 'test',
      capabilities: ['ORDER_EXECUTION'],
      placeOrder: async (): Promise<unknown> =>
        ({ orderId: 'v-1', status: 'FILLED', filledQuantity: 0.5, avgFillPrice: fillPrice }),
      cancelOrder: async (): Promise<void> => undefined,
    }) as unknown as IExecutionBroker;

  it('records a fill when the submit path folds a FILLED broker view', async () => {
    const store = tempStore();
    const engine = new ExecutionEngine(instantBroker(101), store);
    const recorded: number[] = [];
    engine.setFillHook((tracked): void => {
      recorded.push(tracked.filledQuantity);
    });
    engine.registerApproved({
      intentId: 'd-1', pair: 'B-BTC_USDT', symbol: 'BTCUSDT', side: 'buy', quantity: 0.5,
    });
    await engine.submit('d-1', { pair: 'B-BTC_USDT', side: 'buy', orderType: 'market_order', quantity: 0.5, leverage: 1, marginType: 'isolated' });
    expect(recorded).toEqual([0.5]);
  });

  it('does NOT fire for folds without a new quantity (idempotent folds)', () => {
    const engine = new ExecutionEngine(instantBroker(101), tempStore());
    let fires = 0;
    engine.setFillHook((): void => {
      fires++;
    });
    engine.registerApproved({
      intentId: 'd-2', pair: 'B-BTC_USDT', symbol: 'BTCUSDT', side: 'buy', quantity: 0.5,
    });
    const tracked = engine.get('d-2')!;
    // Reach SUBMITTING the legal way before folding broker truth.
    engine.transition(tracked, 'SUBMITTING');
    const view = { orderId: 'v-1', status: 'FILLED' as const, filledQuantity: 0.5, avgFillPrice: 101 };
    engine.applyBrokerUpdate(tracked, view);
    engine.applyBrokerUpdate(tracked, view); // same fold again (poll)
    expect(fires).toBe(1);
  });
});
