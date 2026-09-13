import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { EventStore } from '../src/infrastructure/events/event-store.js';
import { MarketStateStore } from '../src/engines/market-state-store.js';
import { AlertDispatcher } from '../src/engines/alerts/dispatcher.js';
import { SystemMonitor } from '../src/engines/alerts/system-monitor.js';
import { tradeAlertFromEvent } from '../src/engines/alerts/trade-monitor.js';
import { DEFAULT_RISK_LIMITS } from '../src/domain/risk/risk-config.js';

describe('SYSTEM monitor', () => {
  it('emits stale then recovered', async () => {
    const store = new EventStore({ filePath: join(mkdtempSync(join(tmpdir(), 'al-')), 'e.jsonl') });
    const market = new MarketStateStore();
    const dispatcher = new AlertDispatcher(store);
    const emitted: string[] = [];
    store.onAppend((e) => {
      if (e.type === 'alert.emitted') {
        emitted.push(String((e.payload as { title?: string }).title));
      }
    });
    let now = 10_000;
    const mon = new SystemMonitor({
      store,
      marketStore: market,
      dispatcher,
      symbols: () => ['SOLUSDT'],
      maxStaleMs: 2_000,
      limits: DEFAULT_RISK_LIMITS,
      dailyLossPercent: () => 0,
      drawdownPercent: () => 0,
      lossStreak: () => 0,
      now: () => now,
    });
    market.setTicker({ symbol: 'SOLUSDT', price: 100, at: 1_000 });
    await mon.tick();
    expect(emitted.some((t) => t.includes('STALE'))).toBe(true);
    now = 1_500;
    market.setTicker({ symbol: 'SOLUSDT', price: 101, at: 1_400 });
    await mon.tick();
    expect(emitted.some((t) => t.includes('RECOVERED'))).toBe(true);
  });
});

describe('TRADE producer', () => {
  it('maps fill.recorded to TRADE EXECUTED', () => {
    const alert = tradeAlertFromEvent({
      at: 1, type: 'fill.recorded', symbol: 'SOLUSDT', decisionId: 'd1',
      payload: { side: 'buy', price: 101.82, quantity: 1, intentType: 'ENTRY', symbol: 'SOLUSDT' },
    });
    expect(alert?.title).toBe('TRADE EXECUTED');
    expect(alert?.class).toBe('TRADE');
  });
});
