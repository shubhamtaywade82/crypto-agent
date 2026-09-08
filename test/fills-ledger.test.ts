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

describe('FillsLedger — position accounting + live PnL attribution (V3.1 FIFO lots)', () => {
  it('EXIT closes lots FIFO and attributes one allocation per entry decision', () => {
    const closes: { decisionId: string; pnl: number; positionId?: string }[] = [];
    const ledger = new FillsLedger(
      tempStore(), 'coindcx',
      (a): void => {
        closes.push({ decisionId: a.decisionId, pnl: a.pnl, positionId: a.positionId });
      }
    );
    // Long 0.5 @ 100 then 0.5 @ 110 -> two lots; exit all @ 120.
    ledger.record(trackedOf({ intentId: 'e-1', filledQuantity: 0.5, avgFillPrice: 100, intentType: 'ENTRY' }), 1_100);
    ledger.record(trackedOf({ intentId: 'e-2', filledQuantity: 0.5, avgFillPrice: 110, intentType: 'ENTRY' }), 1_200);
    ledger.record(
      trackedOf({ intentId: 'x-1', side: 'sell', filledQuantity: 1.0, avgFillPrice: 120, intentType: 'EXIT' }), 1_300
    );
    // FIFO: first lot 0.5*(120-100)=+10 credited to e-1, second 0.5*(120-110)=+5 to e-2.
    expect(closes).toHaveLength(2);
    expect(closes[0]).toMatchObject({ decisionId: 'e-1', pnl: 10 });
    expect(closes[1]).toMatchObject({ decisionId: 'e-2', pnl: 5 });
    expect(closes[0].positionId).toBe(closes[1].positionId); // same netting position
    expect(ledger.quality().realizedPnl).toBeCloseTo(15, 6);
    expect(ledger.quality().realizedTrades).toBe(2);
    expect(ledger.quality().positionsOpened).toBe(1);
    expect(ledger.quality().positionsClosed).toBe(1);
    expect(ledger.quality().openPositions).toBe(0);
  });

  it('scale-in entries append lots to the SAME position (positionId -> lots -> decisionId)', () => {
    const ledger = new FillsLedger(tempStore(), 'coindcx');
    ledger.record(trackedOf({ intentId: 'e-1', filledQuantity: 0.5, avgFillPrice: 100, intentType: 'ENTRY' }), 1_100);
    ledger.record(trackedOf({ intentId: 'e-2', filledQuantity: 1.0, avgFillPrice: 110, intentType: 'ENTRY' }), 1_200);
    expect(ledger.quality().positionsOpened).toBe(1); // scale-in, not a new position
    const [pos] = ledger.openPositions();
    expect(pos.positionId).toBe('pos:BTCUSDT:buy:e-1');
    expect(pos.lots).toHaveLength(2);
    expect(pos.lots[0]).toMatchObject({ decisionId: 'e-1', price: 100 });
    expect(pos.lots[1]).toMatchObject({ decisionId: 'e-2', price: 110 });
  });

  it('short positions: exit below entry realizes profit', () => {
    const closes: number[] = [];
    const ledger = new FillsLedger(tempStore(), 'coindcx', (a): void => {
      closes.push(a.pnl);
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
    const ledger = new FillsLedger(tempStore(), 'coindcx', (a): void => {
      closes.push(a.pnl);
    });
    ledger.record(trackedOf({ intentId: 'e-1', filledQuantity: 0.5, avgFillPrice: 100, intentType: 'ENTRY' }), 1_100);
    ledger.record(
      trackedOf({ intentId: 'x-1', side: 'sell', filledQuantity: 2, avgFillPrice: 110, intentType: 'REDUCE' }), 1_200
    );
    expect(closes).toHaveLength(1);
    expect(closes[0]).toBeCloseTo(5, 6); // 0.5 * (110 - 100)
  });

  it('opposite ENTRY nets the position down first, remainder flips', () => {
    const ledger = new FillsLedger(tempStore(), 'coindcx');
    ledger.record(trackedOf({ intentId: 'e-1', filledQuantity: 1, avgFillPrice: 100, intentType: 'ENTRY' }), 1_100);
    // Opposite-side ENTRY of 1.2: closes the long (pnl -2 on 0.2 over), flips short.
    ledger.record(
      trackedOf({ intentId: 'e-2', side: 'sell', filledQuantity: 1.2, avgFillPrice: 98, intentType: 'ENTRY' }), 1_200
    );
    expect(ledger.quality().positionsClosed).toBe(1);
    expect(ledger.quality().positionsOpened).toBe(2);
    const [short] = ledger.openPositions();
    expect(short.side).toBe('sell');
    expect(short.lots[0].decisionId).toBe('e-2');
    expect(short.lots[0].quantity).toBeCloseTo(0.2, 6);
  });

  it('persists position.opened / position.closed audit events', () => {
    const store = tempStore();
    const ledger = new FillsLedger(store, 'coindcx');
    ledger.record(trackedOf({ intentId: 'e-1', filledQuantity: 1, avgFillPrice: 100, intentType: 'ENTRY' }), 1_100);
    ledger.record(
      trackedOf({ intentId: 'x-1', side: 'sell', filledQuantity: 1, avgFillPrice: 105, intentType: 'EXIT' }), 1_200
    );
    const types = store.readAll(50).map((e) => e.type);
    expect(types).toContain('position.opened');
    expect(types).toContain('position.closed');
  });

  it('PAPER venue does not invoke the close callback (paper broker owns it)', () => {
    const closes: number[] = [];
    const ledger = new FillsLedger(tempStore(), 'paper', (a): void => {
      closes.push(a.pnl);
    });
    ledger.record(trackedOf({ intentId: 'e-1', filledQuantity: 1, avgFillPrice: 100, intentType: 'ENTRY' }), 1_100);
    ledger.record(
      trackedOf({ intentId: 'x-1', side: 'sell', filledQuantity: 1, avgFillPrice: 110, intentType: 'EXIT' }), 1_200
    );
    expect(ledger.quality().realizedTrades).toBe(1);
    expect(closes).toHaveLength(0);
  });

  it('EXIT without an open position is recorded but not attributed', () => {
    const closes: number[] = [];
    const ledger = new FillsLedger(tempStore(), 'coindcx', (a): void => {
      closes.push(a.pnl);
    });
    ledger.record(
      trackedOf({ intentId: 'x-1', side: 'sell', filledQuantity: 1, avgFillPrice: 100, intentType: 'EXIT' }), 1_100
    );
    expect(ledger.quality().fills).toBe(1);
    expect(closes).toHaveLength(0);
    expect(ledger.quality().realizedTrades).toBe(0);
  });

  it('RESTART: hydrate replays fills WITHOUT re-firing the close fan-out (exactly-once)', () => {
    const store = tempStore();
    const closes: number[] = [];
    const make = (): FillsLedger =>
      new FillsLedger(store, 'coindcx', (a): void => {
        closes.push(a.pnl);
      });
    const ledger = make();
    ledger.record(trackedOf({ intentId: 'e-1', filledQuantity: 1, avgFillPrice: 100, intentType: 'ENTRY' }), 1_100);
    ledger.record(
      trackedOf({ intentId: 'x-1', side: 'sell', filledQuantity: 1, avgFillPrice: 110, intentType: 'EXIT' }), 1_200
    );
    expect(closes).toEqual([10]);
    const liveEvents = store.readAll(Number.MAX_SAFE_INTEGER).length;
    // Fresh instance over the same event store (restart scenario).
    const reborn = make();
    reborn.hydrate();
    // The fan-out must NOT re-fire on replay (double counting corrupts risk).
    expect(closes).toEqual([10]);
    // Replaying persists nothing new (position events are replay-idempotent).
    expect(store.readAll(Number.MAX_SAFE_INTEGER).length).toBe(liveEvents);
    // State is fully rebuilt.
    expect(reborn.quality()).toEqual(ledger.quality());
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
