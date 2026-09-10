import { describe, it, expect } from 'vitest';
import { buildStreams } from '../src/kernel-streams.js';
import { MarketStateStore } from '../src/engines/market-state-store.js';
import { PortfolioStateStore } from '../src/engines/portfolio-state-store.js';
import { EventStore } from '../src/infrastructure/events/event-store.js';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { IMarketDataProvider } from '../src/infrastructure/broker/broker.js';

const stubProvider = (): IMarketDataProvider => ({
  id: 'test', capabilities: ['MARKET_DATA'],
  getKlines: async () => [],
  getTickerPrice: async () => 100,
  getMarkIndex: async () => ({ mark: 100, index: 100 }),
  getFundingRate: async () => 0,
  getOpenInterest: async () => ({ oi: 1, changePct: 0 }),
  getOrderBookDepth: async () => ({ bids: [], asks: [] }),
  getAggTrades: async () => [],
});

describe('kernel streams — shared market store', () => {
  it('wires the WS stream to the kernel-injected store (no shadow copy)', () => {
    const marketStore = new MarketStateStore();
    const accountCache = new PortfolioStateStore();
    const streams = buildStreams({
      audit: new EventStore({ filePath: join(mkdtempSync(join(tmpdir(), 'ks-')), 'e.jsonl') }),
      provider: stubProvider(),
      log: { info: (): void => {}, warn: (): void => {}, error: (): void => {}, debug: (): void => {} },
      venue: 'paper',
      marketStore,
      accountCache,
    });
    expect(streams.marketStore).toBe(marketStore);
    expect(streams.accountCache).toBe(accountCache);
    marketStore.setDepth({
      symbol: 'BTCUSDT', at: 1,
      bids: [{ price: 99.9, qty: 5 }], asks: [{ price: 100.1, qty: 3 }],
    });
    expect(streams.marketStore.snapshot('BTCUSDT')?.microstructure?.imbalance).toBeGreaterThan(0);
  });
});
