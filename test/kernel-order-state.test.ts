import { describe, it, expect } from 'vitest';
import { canTransition, isTerminal, isFailure, assertTransition } from '../src/domain/orders/order-state.js';
import type { OrderStatus } from '../src/domain/orders/order-state.js';

describe('order state machine', () => {
  it('allows the happy path to FILLED', () => {
    const path: OrderStatus[] = [
      'ORDER_INTENT', 'RISK_APPROVED', 'SUBMITTING', 'SUBMITTED',
      'ACKNOWLEDGED', 'PARTIALLY_FILLED', 'FILLED', 'POSITION_OPEN', 'PROTECTED',
    ];
    for (let i = 0; i < path.length - 1; i++) {
      expect(canTransition(path[i]!, path[i + 1]!), `${path[i]}->${path[i + 1]}`).toBe(true);
    }
  });

  it('routes SUBMITTING to UNKNOWN on timeout', () => {
    expect(canTransition('SUBMITTING', 'UNKNOWN')).toBe(true);
    expect(canTransition('SUBMITTED', 'UNKNOWN')).toBe(true);
    expect(canTransition('UNKNOWN', 'FILLED')).toBe(true);
    expect(canTransition('UNKNOWN', 'CANCELLED')).toBe(true);
    expect(canTransition('UNKNOWN', 'CLOSED')).toBe(true);
  });

  it('rejects illegal transitions', () => {
    expect(canTransition('ORDER_INTENT', 'FILLED')).toBe(false);
    expect(canTransition('FILLED', 'SUBMITTING')).toBe(false);
    expect(canTransition('CLOSED', 'POSITION_OPEN')).toBe(false);
    expect(canTransition('REJECTED', 'RISK_APPROVED')).toBe(false);
    expect(canTransition('SUBMITTING', 'ORDER_INTENT')).toBe(false);
  });

  it('treats CLOSED as terminal and UNKNOWN as failure', () => {
    expect(isTerminal('CLOSED')).toBe(true);
    expect(isTerminal('REJECTED')).toBe(true);
    expect(isTerminal('FILLED')).toBe(false);
    expect(isFailure('UNKNOWN')).toBe(true);
    expect(isFailure('EXPIRED')).toBe(true);
    expect(isFailure('FILLED')).toBe(false);
  });

  it('throws on illegal transition via assertTransition', () => {
    expect(() => assertTransition('CLOSED', 'FILLED')).toThrow(/Illegal order state transition/);
    expect(() => assertTransition('RISK_APPROVED', 'SUBMITTING')).not.toThrow();
  });
});
