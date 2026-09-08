import { describe, it, expect } from 'vitest';
import { CoinDCXAccountStream } from '../src/infrastructure/coindcx/account-stream.js';
import { PortfolioStateStore } from '../src/engines/portfolio-state-store.js';
import { EventStore } from '../src/infrastructure/events/event-store.js';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const tempStore = (): EventStore =>
  new EventStore({ filePath: join(mkdtempSync(join(tmpdir(), 'acct-')), 'events.jsonl') });

/** Scriptable stand-in for the SDK client's WS emitter surface. */
class FakeWs {
  private readonly listeners = new Map<string, Array<(data?: unknown) => void>>();
  on(event: string, handler: (data?: unknown) => void): void {
    const list = this.listeners.get(event) ?? [];
    list.push(handler);
    this.listeners.set(event, list);
  }
  emit(event: string, data?: unknown): void {
    for (const h of this.listeners.get(event) ?? []) h(data);
  }
}

interface FakeClient {
  readonly ws: FakeWs;
  connected: number;
  privateSubscribed: number;
  disconnected: number;
  connectWebsocket(): Promise<void>;
  subscribePrivateStreams(): void;
  disconnect(): void;
}

const fakeClient = (): FakeClient => {
  const client = {
    ws: new FakeWs(),
    connected: 0,
    privateSubscribed: 0,
    disconnected: 0,
    connectWebsocket(): void {
      client.connected++;
    },
    subscribePrivateStreams(): void {
      client.privateSubscribed++;
    },
    disconnect(): void {
      client.disconnected++;
    },
  };
  return client;
};

interface Harness {
  readonly stream: CoinDCXAccountStream;
  readonly client: FakeClient;
  readonly store: PortfolioStateStore;
  readonly audit: EventStore;
  readonly resyncs: number;
}

const harness = (opts?: { resync?: () => Promise<void> }): Harness => {
  const store = new PortfolioStateStore();
  const audit = tempStore();
  const client = fakeClient();
  let resyncs = 0;
  const stream = new CoinDCXAccountStream({
    client: client as never,
    store,
    audit,
    resync: opts?.resync ?? (async (): Promise<void> => {
      resyncs++;
    }),
    now: () => 1_000,
  });
  return { stream, client, store, audit, get resyncs(): number { return resyncs; } };
};

describe('CoinDCXAccountStream — subscription lifecycle', () => {
  it('connects, subscribes private streams, and starts DISCONNECTED until open', async () => {
    const h = harness();
    await h.stream.start();
    expect(h.client.connected).toBe(1);
    expect(h.client.privateSubscribed).toBe(1);
    expect(h.stream.state).toBe('DISCONNECTED');
    h.client.ws.emit('open');
    await Promise.resolve();
    expect(h.stream.state).toBe('CONNECTED');
  });

  it('re-seeds the account cache from REST on EVERY open (recovery path)', async () => {
    const h = harness();
    await h.stream.start();
    h.client.ws.emit('open');
    await Promise.resolve();
    await Promise.resolve();
    expect(h.resyncs).toBe(1);
    h.client.ws.emit('close', 'socket reset');
    expect(h.stream.state).toBe('DISCONNECTED');
    h.client.ws.emit('open');
    await Promise.resolve();
    await Promise.resolve();
    expect(h.resyncs).toBe(2); // reconnect resync
  });

  it('stop() detaches and disconnects exactly once', async () => {
    const h = harness();
    await h.stream.start();
    h.stream.stop();
    h.stream.stop();
    expect(h.client.disconnected).toBe(1);
    expect(h.stream.state).toBe('IDLE');
  });
});

describe('CoinDCXAccountStream — event translation into the store', () => {
  it('position updates upsert by pair#side; zero size removes', async () => {
    const h = harness();
    await h.stream.start();
    h.client.ws.emit('df-position-update', {
      pair: 'B-BTC_USDT', side: 'long', size: 0.5, entry_price: 60000,
      mark_price: 61000, unrealized_pnl: 500, timestamp: 5,
    });
    h.client.ws.emit('df-position-update', {
      pair: 'B-BTC_USDT', side: 'long', size: 0.6, entry_price: 60000, timestamp: 6,
    });
    h.client.ws.emit('df-position-update', {
      pair: 'B-ETH_USDT', side: 'short', size: 2, entry_price: 3000, timestamp: 7,
    });
    expect(h.store.positionsNow()).toHaveLength(2);
    h.client.ws.emit('df-position-update', {
      pair: 'B-ETH_USDT', side: 'short', size: 0, entry_price: 3000, timestamp: 8,
    });
    const positions = h.store.positionsNow();
    expect(positions).toHaveLength(1);
    expect(positions[0].size).toBe(0.6);
    expect(h.store.isFresh(1000, 8)).toBe(true); // last event at t=8
    expect(h.store.isFresh(1000, 1_009)).toBe(false);
  });

  it('balance updates key by currency and drop emptied entries', async () => {
    const h = harness();
    await h.stream.start();
    h.client.ws.emit('balance-update', { currency: 'usdt', balance: 1000, timestamp: 1 });
    h.client.ws.emit('balance-update', { currency: 'INR', balance: 50000, timestamp: 2 });
    expect(h.store.balancesNow().map((b) => b.currency).sort()).toEqual(['INR', 'USDT']);
    h.client.ws.emit('balance-update', { currency: 'INR', balance: 0, locked_balance: 0, timestamp: 3 });
    expect(h.store.balancesNow().map((b) => b.currency)).toEqual(['USDT']);
  });

  it('order updates are tracked by id for reconciliation hints', async () => {
    const h = harness();
    await h.stream.start();
    h.client.ws.emit('df-order-update', {
      id: 'ord-1', client_order_id: 'dec-1', pair: 'B-BTC_USDT',
      status: 'open', filled_quantity: 0, timestamp: 9,
    });
    h.client.ws.emit('df-order-update', {
      id: 'ord-1', status: 'filled', filled_quantity: 0.5, timestamp: 10,
    });
    expect(h.store.lastOrder('ord-1')?.status).toBe('filled');
  });

  it('malformed events are ignored without state corruption', async () => {
    const h = harness();
    await h.stream.start();
    expect(() => {
      h.client.ws.emit('df-position-update', { pair: 'B-BTC_USDT' });
      h.client.ws.emit('balance-update', { balance: 5 });
      h.client.ws.emit('df-order-update', { status: 'open' });
    }).not.toThrow();
    expect(h.store.positionsNow()).toHaveLength(0);
    expect(h.store.balancesNow()).toHaveLength(0);
  });
});

describe('CoinDCXAccountStream — audit trail', () => {
  it('persists stream state transitions', async () => {
    const h = harness();
    await h.stream.start();
    h.client.ws.emit('open');
    await Promise.resolve();
    const types = h.audit.readAll(20).map((e) => e.type);
    expect(types).toContain('account.stream.state');
    const events = h.audit.readAll(20).filter((e) => e.type === 'account.stream.state');
    expect(events.some((e) => (e.payload as { state: string }).state === 'CONNECTED')).toBe(true);
  });
});
