import { describe, it, expect } from 'vitest';
import { EventStore, EventPersistenceError } from '../src/infrastructure/events/event-store.js';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** An "unwritable" target that fails instantly (EISDIR): an existing directory. */
const unwritableTarget = (): string => mkdtempSync(join(tmpdir(), 'evro-'));

describe('EventStore — durability contract', () => {
  it('classifies critical events and persists them', () => {
    const dir = mkdtempSync(join(tmpdir(), 'evdur-'));
    const store = new EventStore({ filePath: join(dir, 'events.jsonl'), durable: true });
    expect(store.isDurable).toBe(true);

    store.append({ type: 'pipeline.snapshot', payload: {} });
    store.appendCritical({ type: 'order.transition', payload: { from: 'A', to: 'B' } });
    store.appendClassified({ type: 'order.unknown', payload: {} });

    const all = store.readAll(10);
    expect(all.map((e) => e.type)).toEqual([
      'pipeline.snapshot', 'order.transition', 'order.unknown',
    ]);
    expect(store.healthy).toBe(true);
  });

  it('durable mode: a failed critical write throws and marks the store unhealthy', () => {
    const store = new EventStore({ filePath: unwritableTarget(), durable: true });
    expect(() =>
      store.appendCritical({ type: 'order.transition', payload: {} })
    ).toThrow(EventPersistenceError);
    expect(store.healthy).toBe(false);
    expect(store.writeFailureCount).toBe(1);
    expect(store.lastError).toBeDefined();
  });

  it('durable mode: a failed non-critical write degrades without throwing', () => {
    const store = new EventStore({ filePath: unwritableTarget(), durable: true });
    expect(() => store.append({ type: 'pipeline.snapshot', payload: {} })).not.toThrow();
    expect(store.healthy).toBe(false);
  });

  it('non-durable mode: critical writes record failure without throwing (paper/dev)', () => {
    const store = new EventStore({ filePath: unwritableTarget(), durable: false });
    expect(() =>
      store.appendCritical({ type: 'order.transition', payload: {} })
    ).not.toThrow();
    expect(store.healthy).toBe(false);
  });
});
