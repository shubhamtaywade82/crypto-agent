import { describe, it, expect } from 'vitest';
import { SymbolLanes } from '../src/engines/event-bus.js';

const delay = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

describe('SymbolLanes (per-symbol serialized processing)', () => {
  it('serializes work within one symbol lane', async () => {
    const lanes = new SymbolLanes();
    const order: number[] = [];
    await Promise.all([
      lanes.enqueue('SOLUSDT', async () => { await delay(30); order.push(1); }),
      lanes.enqueue('SOLUSDT', async () => { await delay(10); order.push(2); }),
      lanes.enqueue('SOLUSDT', async () => { order.push(3); }),
    ]);
    expect(order).toEqual([1, 2, 3]);
  });

  it('processes different symbols concurrently', async () => {
    const lanes = new SymbolLanes();
    const finished: string[] = [];
    const slow = lanes.enqueue('BTCUSDT', async () => {
      await delay(40);
      finished.push('btc');
    });
    const fast = lanes.enqueue('ETHUSDT', async () => {
      await delay(5);
      finished.push('eth');
    });
    await Promise.all([slow, fast]);
    expect(finished).toEqual(['eth', 'btc']);
  });

  it('a failing task does not poison the lane', async () => {
    const lanes = new SymbolLanes();
    const results: string[] = [];
    await expect(lanes.enqueue('SOLUSDT', async () => {
      throw new Error('boom');
    })).rejects.toThrow('boom');
    await lanes.enqueue('SOLUSDT', async () => { results.push('recovered'); });
    expect(results).toEqual(['recovered']);
  });

  it('global lane serializes across symbols', async () => {
    const lanes = new SymbolLanes();
    const order: string[] = [];
    await Promise.all([
      lanes.enqueueGlobal(async () => { await delay(20); order.push('g1'); }),
      lanes.enqueue('SOLUSDT', async () => { await delay(1); order.push('s1'); }),
      lanes.enqueueGlobal(async () => { order.push('g2'); }),
    ]);
    expect(order.indexOf('g1')).toBeLessThan(order.indexOf('g2'));
  });
});
