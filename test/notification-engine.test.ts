import { describe, expect, it } from 'vitest';
import { makeAlert } from '../src/engines/alerts/make-alert.js';
import { NotificationEngine } from '../src/engines/alerts/notification-engine.js';
import { defaultSubscriptions } from '../src/engines/alerts/subscriptions.js';
import type { AlertEvent } from '../src/domain/alerts/types.js';

const alert = (over: Partial<AlertEvent> = {}): AlertEvent =>
  makeAlert({
    at: 1_000,
    class: 'MARKET',
    severity: 'IMPORTANT',
    symbol: 'SOLUSDT',
    title: 'REGIME CHANGE',
    body: 'RANGE → TREND_UP',
    fingerprint: 'MARKET:SOLUSDT:regime',
    stateFrom: 'RANGE',
    stateTo: 'TREND_UP',
    payload: {},
    ...over,
  });

describe('NotificationEngine', () => {
  it('emits the first observation of a fingerprint', () => {
    const engine = new NotificationEngine();
    const d = engine.submit(alert());
    expect(d.action).toBe('emitted');
  });

  it('suppresses the same fingerprint and stateTo', () => {
    const engine = new NotificationEngine();
    engine.submit(alert());
    const d = engine.submit(alert({ id: 'a2', at: 2_000 }));
    expect(d.action).toBe('suppressed');
    expect(d.reason).toBe('DEDUPE');
  });

  it('emits when stateTo changes', () => {
    const engine = new NotificationEngine();
    engine.submit(alert());
    const d = engine.submit(alert({
      id: 'a2', at: 2_000, stateFrom: 'TREND_UP', stateTo: 'RANGE', body: 'TREND_UP → RANGE',
    }));
    expect(d.action).toBe('emitted');
  });

  it('suppresses LEVEL APPROACHING by default', () => {
    const engine = new NotificationEngine();
    const d = engine.submit(alert({
      class: 'LEVEL',
      severity: 'WATCH',
      title: 'LEVEL APPROACHING',
      fingerprint: 'LEVEL:SOLUSDT:res:102.20',
      stateTo: 'APPROACHING',
      payload: { kind: 'APPROACHING' },
    }));
    expect(d.action).toBe('suppressed');
    expect(d.reason).toBe('LEVEL_APPROACHING');
  });

  it('emits LEVEL REACHED by default', () => {
    const engine = new NotificationEngine();
    const d = engine.submit(alert({
      class: 'LEVEL',
      severity: 'IMPORTANT',
      title: 'LEVEL REACHED',
      fingerprint: 'LEVEL:SOLUSDT:res:102.20',
      stateTo: 'REACHED',
      payload: { kind: 'REACHED' },
    }));
    expect(d.action).toBe('emitted');
  });

  it('drops symbol-scoped classes when the symbol is disabled', () => {
    const engine = new NotificationEngine({
      ...defaultSubscriptions(),
      symbols: { SOLUSDT: false },
    });
    const d = engine.submit(alert());
    expect(d.action).toBe('suppressed');
    expect(d.reason).toBe('SYMBOL');
  });

  it('still emits SYSTEM CRITICAL when the symbol is disabled', () => {
    const engine = new NotificationEngine({
      ...defaultSubscriptions(),
      symbols: { SOLUSDT: false },
    });
    const d = engine.submit(alert({
      class: 'SYSTEM',
      severity: 'CRITICAL',
      title: 'DATA STALE',
      fingerprint: 'SYSTEM:SOLUSDT:stale',
      stateTo: 'STALE',
    }));
    expect(d.action).toBe('emitted');
  });

  it('suppresses SIGNAL below confidence or RR gates', () => {
    const engine = new NotificationEngine();
    const lowConf = engine.submit(alert({
      class: 'SIGNAL',
      severity: 'SIGNAL',
      title: 'LONG SIGNAL',
      fingerprint: 'SIGNAL:SOLUSDT:long',
      stateTo: 'CONFIRMED',
      payload: { confidence: 0.5, rr: 3 },
    }));
    expect(lowConf.reason).toBe('CONFIDENCE');
    const lowRr = engine.submit(alert({
      class: 'SIGNAL',
      severity: 'SIGNAL',
      title: 'LONG SIGNAL',
      fingerprint: 'SIGNAL:ETHUSDT:long',
      symbol: 'ETHUSDT',
      stateTo: 'CONFIRMED',
      payload: { confidence: 0.9, rr: 1.2 },
    }));
    expect(lowRr.reason).toBe('RR');
  });

  it('suppresses below minSeverity except SYSTEM CRITICAL', () => {
    const engine = new NotificationEngine({ ...defaultSubscriptions(), minSeverity: 'IMPORTANT' });
    const watch = engine.submit(alert({
      class: 'SETUP',
      severity: 'WATCH',
      title: 'SETUP DEVELOPING',
      fingerprint: 'SETUP:SOLUSDT:watch',
      stateTo: 'WATCHING',
    }));
    expect(watch.reason).toBe('SEVERITY');
    const sys = engine.submit(alert({
      class: 'SYSTEM',
      severity: 'CRITICAL',
      title: 'WS DOWN',
      fingerprint: 'SYSTEM:ws',
      stateTo: 'DOWN',
    }));
    expect(sys.action).toBe('emitted');
  });
});
