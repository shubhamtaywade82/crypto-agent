import { describe, it, expect } from 'vitest';
import {
  computeMicrostructure,
  microstructureConfidenceDelta,
} from '../src/engines/microstructure-engine.js';

describe('microstructure-engine', () => {
  it('computes spread, imbalance and flow from depth + trades', () => {
    const view = computeMicrostructure(
      {
        bids: [{ price: 100, qty: 10 }, { price: 99.5, qty: 5 }],
        asks: [{ price: 100.1, qty: 4 }, { price: 100.2, qty: 2 }],
      },
      [
        { price: 100.05, qty: 2, at: 1, buyerIsMaker: false },
        { price: 100.04, qty: 1, at: 2, buyerIsMaker: true },
      ],
      100.05
    );
    expect(view.spreadBps).toBeGreaterThan(0);
    expect(view.bidDepth).toBe(15);
    expect(view.askDepth).toBe(6);
    expect(view.imbalance).toBeGreaterThan(0);
    expect(view.buyVolume).toBeGreaterThan(0);
    expect(view.sellVolume).toBeGreaterThan(0);
  });

  it('penalizes confidence when flow fights the direction', () => {
    const hostile = computeMicrostructure(
      { bids: [{ price: 100, qty: 2 }], asks: [{ price: 100.2, qty: 20 }] },
      [{ price: 100.1, qty: 5, at: 1, buyerIsMaker: true }],
      100.1
    );
    expect(microstructureConfidenceDelta(hostile, 'LONG')).toBeLessThan(0);
  });
});
