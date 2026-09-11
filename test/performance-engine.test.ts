import { describe, it, expect } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EventStore } from '../src/infrastructure/events/event-store.js';
import { PerformanceEngine } from '../src/engines/performance-engine.js';

describe('PerformanceEngine — equity persistence throttle', () => {
  it('does not append portfolio.equity on every identical refresh', () => {
    const dir = mkdtempSync(join(tmpdir(), 'perf-'));
    const store = new EventStore({ filePath: join(dir, 'events.jsonl'), durable: false });
    const perf = new PerformanceEngine(store);
    perf.recordEquity(10_000, 1_000);
    perf.recordEquity(10_000, 2_000);
    perf.recordEquity(10_000, 3_000);
    expect(store.readAll(10).filter((e) => e.type === 'portfolio.equity')).toHaveLength(1);
  });

  it('persists again after a material equity move or interval elapses', () => {
    const dir = mkdtempSync(join(tmpdir(), 'perf2-'));
    const store = new EventStore({ filePath: join(dir, 'events.jsonl'), durable: false });
    const perf = new PerformanceEngine(store);
    perf.recordEquity(10_000, 1_000);
    perf.recordEquity(10_001, 2_000);
    perf.recordEquity(10_000, 62_000);
    const equityEvents = store.readAll(10).filter((e) => e.type === 'portfolio.equity');
    expect(equityEvents).toHaveLength(3);
  });
});
