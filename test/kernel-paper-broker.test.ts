import { describe, it, expect } from 'vitest';
import { PaperExecutionBroker } from '../src/infrastructure/paper/paper-broker-adapter.js';
import { FALLBACK_SPEC } from '../src/domain/futures/contract-spec.js';

const SOL_SPEC = FALLBACK_SPEC('SOL');

describe('PaperExecutionBroker', () => {
  const fresh = (): PaperExecutionBroker => {
    const b = new PaperExecutionBroker({
      initialBalance: 10_000, takerFeeRate: 0.0005, slippageRate: 0.0005, spec: SOL_SPEC,
    });
    b.setMarkPrice('B-SOL_USDT', 100);
    return b;
  };

  const order = (over: Record<string, unknown> = {}) => ({
    pair: 'B-SOL_USDT', side: 'buy' as const, orderType: 'market_order' as const,
    quantity: 1, leverage: 2, marginType: 'isolated' as const, ...over,
  });

  it('fills a market buy with slippage and charges fees', async () => {
    const b = fresh();
    const res = await b.placeOrder({ intentId: 't1', ...order() });
    expect(res.status).toBe('FILLED');
    expect(res.avgFillPrice).toBeCloseTo(100.05, 6);
    const balances = await b.getBalances();
    expect(balances[0]!.total).toBeLessThan(10_000);
  });

  it('aggregates into one long position and computes uPnL', async () => {
    const b = fresh();
    await b.placeOrder({ intentId: 't1', ...order({ quantity: 2 }) });
    await b.placeOrder({ intentId: 't2', ...order({ quantity: 3 }) });
    const positions = await b.getPositions();
    expect(positions).toHaveLength(1);
    expect(positions[0]!.size).toBe(5);
    expect(positions[0]!.side).toBe('long');
    const entry = positions[0]!.entryPrice;
    b.setMarkPrice('B-SOL_USDT', 110);
    const after = await b.getPositions();
    expect(after[0]!.unrealizedPnl).toBeCloseTo((110 - entry) * 5, 6);
    expect(after[0]!.unrealizedPnl).toBeGreaterThan(0);
  });

  it('triggers stop-loss and take-profit protectively', async () => {
    const b = fresh();
    await b.placeOrder({
      intentId: 't1', ...order({ quantity: 2, stopLoss: 95, takeProfit: 110 }),
    });
    b.setMarkPrice('B-SOL_USDT', 111);
    b.checkProtectiveFills('B-SOL_USDT', 111);
    expect(await b.getPositions()).toHaveLength(0);
    const b2 = fresh();
    await b2.placeOrder({
      intentId: 't2', ...order({ quantity: 2, stopLoss: 95, takeProfit: 110 }),
    });
    b2.setMarkPrice('B-SOL_USDT', 94);
    b2.checkProtectiveFills('B-SOL_USDT', 94);
    expect(await b2.getPositions()).toHaveLength(0);
  });

  it('realizes pnl on reduceOnly close', async () => {
    const b = fresh();
    await b.placeOrder({ intentId: 't1', ...order({ quantity: 2 }) });
    b.setMarkPrice('B-SOL_USDT', 110); // mark above entry -> profitable close
    const before = (await b.getBalances())[0]!.total;
    await b.placeOrder({
      intentId: 't2', ...order({ side: 'sell', quantity: 2, reduceOnly: true }),
    });
    const after = (await b.getBalances())[0]!.total;
    expect(after).toBeGreaterThan(before);
  });

  it('rejects orders that exceed available margin', async () => {
    const b = new PaperExecutionBroker({ initialBalance: 100 });
    b.setMarkPrice('B-SOL_USDT', 100);
    const res = await b.placeOrder({ intentId: 't1', ...order({ quantity: 50, leverage: 1 }) });
    expect(res.status).toBe('REJECTED');
  });

  it('keeps unfilled limit orders open and cancellable', async () => {
    const b = fresh();
    const res = await b.placeOrder({
      intentId: 't1', ...order({ orderType: 'limit_order', price: 50 }),
    });
    expect(res.status).toBe('SUBMITTED');
    expect((await b.getOpenOrders('B-SOL_USDT'))).toHaveLength(1);
    await b.cancelOrder('B-SOL_USDT', res.orderId);
    expect((await b.getOpenOrders('B-SOL_USDT'))).toHaveLength(0);
  });

  it('idempotent lookup by clientOrderId', async () => {
    const b = fresh();
    await b.placeOrder({ intentId: 'same-id', ...order() });
    const found = await b.getOrder('B-SOL_USDT', 'same-id');
    expect(found?.status).toBe('FILLED');
    expect(await b.getOrder('B-SOL_USDT', 'missing-id')).toBeUndefined();
  });

  it('lookupOrder distinguishes FOUND from NOT_FOUND', async () => {
    const b = fresh();
    await b.placeOrder({ intentId: 'known-id', ...order() });
    const found = await b.lookupOrder('B-SOL_USDT', 'known-id');
    expect(found.kind).toBe('FOUND');
    const missing = await b.lookupOrder('B-SOL_USDT', 'unknown-id');
    expect(missing.kind).toBe('NOT_FOUND');
  });

  it('rejects fills beyond the tolerated deviation from expectedPrice', async () => {
    const b = new PaperExecutionBroker({ initialBalance: 10_000, slippageRate: 0.005 }); // 50 bps slip
    b.setMarkPrice('B-SOL_USDT', 100);
    const breached = await b.placeOrder({
      intentId: 'breach', ...order({ expectedPrice: 100, maxSlippageBps: 25 }),
    });
    expect(breached.status).toBe('REJECTED');

    const within = await b.placeOrder({
      intentId: 'within', ...order({ expectedPrice: 100, maxSlippageBps: 100 }),
    });
    expect(within.status).toBe('FILLED');
  });

  it('records realized closes for the performance ledger', async () => {
    const closes: { pnl: number }[] = [];
    const b = new PaperExecutionBroker({
      initialBalance: 10_000,
      onClose: (c) => closes.push({ pnl: c.pnl }),
    });
    b.setMarkPrice('B-SOL_USDT', 100);
    await b.placeOrder({ intentId: 't1', ...order({ quantity: 2 }) });
    b.setMarkPrice('B-SOL_USDT', 110);
    await b.placeOrder({
      intentId: 't2', ...order({ side: 'sell', quantity: 2, reduceOnly: true }),
    });
    expect(closes).toHaveLength(1);
    expect(closes[0]!.pnl).toBeGreaterThan(0);
    expect(b.realizedCloses).toHaveLength(1);
  });
});
