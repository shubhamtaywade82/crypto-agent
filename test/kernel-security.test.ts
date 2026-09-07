import { describe, it, expect } from 'vitest';
import { KillSwitch } from '../src/security/kill-switch.js';
import { ApiAuthenticator } from '../src/security/auth.js';
import {
  parseApiKeys, identityFor, hasCapability, capabilitiesForRole,
} from '../src/security/capabilities.js';
import { EventStore } from '../src/infrastructure/events/event-store.js';
import { ExecutionEngine } from '../src/engines/execution-engine.js';
import { runTradingPipeline, type PipelineDeps } from '../src/engines/pipeline.js';
import type { IExecutionBroker } from '../src/infrastructure/broker/broker.js';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const tempStore = (): EventStore =>
  new EventStore({ filePath: join(mkdtempSync(join(tmpdir(), 'sec-')), 'events.jsonl') });

const fakeBroker = (): IExecutionBroker =>
  ({
    id: 'fake',
    capabilities: ['ORDER_EXECUTION'],
    getInstrument: async () => undefined,
    placeOrder: async () => {
      throw new Error('must not be called while halted');
    },
    cancelOrder: async () => undefined,
    lookupOrder: async () => ({ kind: 'NOT_FOUND' }),
    getOrder: async () => undefined,
    getOpenOrders: async () => [],
    getPositions: async () => [],
    getBalances: async () => [],
    setLeverage: async () => undefined,
    attachTPSL: async () => undefined,
    closePosition: async () => undefined,
  }) as unknown as IExecutionBroker;

describe('KillSwitch — fail-safe global trading gate', () => {
  it('boots HALTED until an explicit resume (fail-safe default)', () => {
    const ks = new KillSwitch();
    expect(ks.state).toBe('HALTED');
    expect(ks.halted).toBe(true);
  });

  it('resume requires a non-empty reason (audit)', () => {
    const ks = new KillSwitch();
    expect(() => ks.resume('', 'op')).toThrow(/non-empty reason/);
    ks.resume('incident resolved, verified flat', 'op-1');
    expect(ks.state).toBe('NORMAL');
    expect(ks.halted).toBe(false);
  });

  it('halts and records actor + reason', () => {
    const ks = new KillSwitch();
    ks.resume('start session', 'op-1', { persist: false });
    ks.halt('venue anomaly', 'op-2', { persist: false });
    expect(ks.halted).toBe(true);
    expect(ks.currentReason).toBe('venue anomaly');
    expect(ks.lastActor).toBe('op-2');
  });

  it('persists state changes to the event store and hydrates them', () => {
    const store = tempStore();
    const ks = new KillSwitch(store);
    ks.hydrate(); // no events: stays HALTED
    ks.resume('go live for the session', 'op-1');
    ks.halt('daily loss breach', 'risk-engine', { persist: false });

    const ks2 = new KillSwitch(store);
    ks2.hydrate();
    // The halt was persist:false, so the last PERSISTED event is the
    // resume — a fresh process resumes as NORMAL, not as the volatile halt.
    expect(ks2.halted).toBe(false);
    expect(ks2.currentReason).toBe('go live for the session');
  });

  it('hydrate replays the full history (last event wins)', () => {
    const store = tempStore();
    const a = new KillSwitch(store);
    a.resume('session start', 'op-1');
    a.halt('kill it', 'op-2');
    const b = new KillSwitch(store);
    b.hydrate();
    expect(b.halted).toBe(true);
    expect(b.currentReason).toBe('kill it');
    expect(b.lastActor).toBe('op-2');
  });

  it('unknown or corrupt events never re-arm trading', () => {
    const store = tempStore();
    store.append({ type: 'killswitch.set', payload: { state: 'GARBAGE' } });
    const ks = new KillSwitch(store);
    ks.hydrate();
    expect(ks.halted).toBe(true);
  });
});

describe('ExecutionEngine — submission gate (defense in depth)', () => {
  const makeEngine = (): { engine: ExecutionEngine; store: EventStore } => {
    const store = tempStore();
    return { engine: new ExecutionEngine(fakeBroker(), store), store };
  };

  it('blocks submit while the gate reports a reason, and audits the block', async () => {
    const { engine, store } = makeEngine();
    engine.setSubmissionGate(() => 'kill switch HALTED: test');
    engine.registerApproved({
      intentId: 'd1', pair: 'B-BTC_USDT', symbol: 'BTCUSDT',
      side: 'buy', quantity: 0.01,
    });
    await expect(engine.submit('d1', {
      pair: 'B-BTC_USDT', side: 'buy', orderType: 'market_order',
      quantity: 0.01, leverage: 2, marginType: 'isolated',
    })).rejects.toThrow(/submission blocked/);
    const blocked = store.readAll(50).filter((e) => e.type === 'order.blocked');
    expect(blocked).toHaveLength(1);
  });

  it('routes broker errors to UNKNOWN once the gate allows (reconciler resolves)', async () => {
    const { engine } = makeEngine();
    engine.setSubmissionGate(() => null);
    engine.registerApproved({
      intentId: 'd2', pair: 'B-BTC_USDT', symbol: 'BTCUSDT',
      side: 'buy', quantity: 0.01,
    });
    // The broker throws (simulated outage) — submit must NOT reject:
    // the FSM goes UNKNOWN and only the Reconciler may resolve it.
    const tracked = await engine.submit('d2', {
      pair: 'B-BTC_USDT', side: 'buy', orderType: 'market_order',
      quantity: 0.01, leverage: 2, marginType: 'isolated',
    });
    expect(tracked.status).toBe('UNKNOWN');
  });
});

describe('Pipeline — HALTED status short-circuits before LLM/venue work', () => {
  it('returns HALTED without touching market data when the gate blocks', async () => {
    const store = tempStore();
    let touched = false;
    const deps = {
      store,
      limits: { minRiskRewardRatio: 2.5 },
      provider: {
        id: 'x', capabilities: ['MARKET_DATA'],
        getKlines: async (): Promise<never[]> => {
          touched = true;
          return [];
        },
      },
      isTradingAllowed: () => ({ allowed: false, reason: 'kill switch HALTED: test' }),
    } as unknown as PipelineDeps;

    const trace = await runTradingPipeline(deps, 'BTCUSDT');
    expect(trace.status).toBe('HALTED');
    expect(trace.error).toContain('kill switch HALTED');
    expect(touched).toBe(false);
    const events = store.readAll(50).filter((e) => e.type === 'pipeline.halted');
    expect(events).toHaveLength(1);
  });
});

describe('Capability-scoped API keys', () => {
  it('parses id:secret:role entries and skips malformed ones', () => {
    const keys = parseApiKeys('k1:s1:trader,k2:s2,bad');
    expect(keys.get('k1')).toEqual({ secret: 's1', role: 'trader' });
    expect(keys.get('k2')?.role).toBe('viewer'); // default
    expect(keys.has('bad')).toBe(false);
  });

  it('secrets may contain colons without mis-granting a role', () => {
    const keys = parseApiKeys('k1:se:cret:trader');
    expect(keys.get('k1')?.secret).toBe('se:cret');
    expect(keys.get('k1')?.role).toBe('trader');
  });

  it('role presets grant escalating capabilities', () => {
    expect(hasCapability(identityFor(parseApiKeys('a:b:viewer'), 'a')!, 'READ_MARKET')).toBe(true);
    expect(hasCapability(identityFor(parseApiKeys('a:b:viewer'), 'a')!, 'EXECUTE')).toBe(false);
    expect(hasCapability(identityFor(parseApiKeys('a:b:operator'), 'a')!, 'RUN_PIPELINE')).toBe(true);
    expect(hasCapability(identityFor(parseApiKeys('a:b:operator'), 'a')!, 'EXECUTE')).toBe(false);
    expect(hasCapability(identityFor(parseApiKeys('a:b:trader'), 'a')!, 'EXECUTE')).toBe(true);
    expect(hasCapability(identityFor(parseApiKeys('a:b:trader'), 'a')!, 'ADMIN')).toBe(false);
    expect(hasCapability(identityFor(parseApiKeys('a:b:admin'), 'a')!, 'ADMIN')).toBe(true);
  });

  it('only admin can resume the kill switch', () => {
    const trader = identityFor(parseApiKeys('t:s:trader'), 't')!;
    const admin = identityFor(parseApiKeys('a:s:admin'), 'a')!;
    expect(hasCapability(trader, 'ADMIN')).toBe(false);
    expect(hasCapability(admin, 'ADMIN')).toBe(true);
    expect(capabilitiesForRole('admin').length)
      .toBeGreaterThan(capabilitiesForRole('trader').length);
  });
});

describe('ApiAuthenticator — fail-closed authn', () => {
  const env = process.env.KERNEL_API_KEYS;

  it('denies everything when no keys are configured', () => {
    delete process.env.KERNEL_API_KEYS;
    const auth = new ApiAuthenticator();
    expect(auth.configured).toBe(false);
    expect(auth.authenticate('Bearer k1:s1')).toBeUndefined();
    expect(auth.authenticate(undefined)).toBeUndefined();
  });

  it('authenticates valid credentials and rejects wrong secrets', () => {
    process.env.KERNEL_API_KEYS = 'k1:secret-one:trader';
    const auth = new ApiAuthenticator();
    expect(auth.configured).toBe(true);
    const ok = auth.authenticate('Bearer k1:secret-one');
    expect(ok?.keyId).toBe('k1');
    expect(ok?.role).toBe('trader');
    expect(auth.authenticate('Bearer k1:wrong')).toBeUndefined();
    expect(auth.authenticate('Bearer unknown:secret-one')).toBeUndefined();
    expect(auth.authenticate('k1:secret-one')).toBeDefined(); // raw header form
  });

  it('rejects malformed credential headers', () => {
    process.env.KERNEL_API_KEYS = 'k1:secret-one:trader';
    const auth = new ApiAuthenticator();
    expect(auth.authenticate('Bearer no-secret')).toBeUndefined();
    expect(auth.authenticate('Bearer :')).toBeUndefined();
    expect(auth.authenticate('')).toBeUndefined();
  });

  process.env.KERNEL_API_KEYS = env;
});
