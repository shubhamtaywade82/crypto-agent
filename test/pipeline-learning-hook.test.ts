import { describe, it, expect } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runTradingPipeline, type PipelineDeps } from '../src/engines/pipeline.js';
import { PortfolioEngine } from '../src/engines/portfolio-engine.js';
import { PerformanceEngine } from '../src/engines/performance-engine.js';
import { ExecutionEngine } from '../src/engines/execution-engine.js';
import { RiskReservationManager } from '../src/engines/risk-reservations.js';
import { PaperExecutionBroker } from '../src/infrastructure/paper/paper-broker-adapter.js';
import { EventStore } from '../src/infrastructure/events/event-store.js';
import { TradeLedger, type TradeFeatureSnapshot } from '../src/learning/trade-ledger.js';
import { DEFAULT_RISK_LIMITS } from '../src/domain/risk/risk-config.js';
import { FALLBACK_SPEC } from '../src/domain/futures/contract-spec.js';
import { buildExecutor } from '../src/kernel-executor.js';
import type { IMarketDataProvider } from '../src/infrastructure/broker/broker.js';
import type { Candle } from '../src/domain/market/types.js';

const zigzag = (n: number, start = 100): Candle[] => {
  const out: Candle[] = [];
  let price = start;
  let i = 0;
  const leg = (dir: 'up' | 'down', count: number) => {
    for (let k = 0; k < count; k++, i++) {
      const open = price;
      const close = dir === 'up' ? price * 1.008 : price * 0.9965;
      const high = dir === 'up' ? close * 1.003 : open * 1.002;
      const low = dir === 'up' ? open * 0.9995 : close * 0.995;
      out.push({ openTime: i * 300_000, open, high, low, close, volume: 1_000 });
      price = close;
    }
  };
  const cycles = Math.floor((n - 12) / 12);
  for (let c = 0; c < cycles; c++) {
    leg('up', 8);
    leg('down', 4);
  }
  while (out.length < n) leg('up', 1);
  return out.slice(0, n);
};

const SERIES: Record<string, Candle[]> = {
  '5m': zigzag(300), '15m': zigzag(300), '1h': zigzag(300), '4h': zigzag(220),
};
const LAST = SERIES['5m']![SERIES['5m']!.length - 1]!.close;

const fakeProvider = (): IMarketDataProvider =>
  ({
    id: 'fake-binance',
    capabilities: ['MARKET_DATA'],
    getKlines: async (_s: string, tf: string, limit: number) =>
      (SERIES[tf] ?? zigzag(limit)).slice(-limit),
    getTickerPrice: async () => LAST,
    getMarkIndex: async () => ({ mark: LAST, index: LAST * 0.999 }),
    getFundingRate: async () => 0.0001,
    getOpenInterest: async () => ({ oi: 1_000, changePct: 0.5 }),
    getOrderBookDepth: async () => ({
      bids: [{ price: 100, qty: 5 }], asks: [{ price: 101, qty: 3 }],
    }),
    getAggTrades: async () => [],
  }) as unknown as IMarketDataProvider;

const makeLearningDeps = (): {
  deps: PipelineDeps;
  ledger: TradeLedger;
  pending: Map<string, TradeFeatureSnapshot>;
} => {
  const store = new EventStore(join(mkdtempSync(join(tmpdir(), 'learn-')), 'events.jsonl'));
  const ledger = new TradeLedger(store);
  const perf = new PerformanceEngine();
  const broker = new PaperExecutionBroker({
    initialBalance: 10_000,
    onClose: (c) => perf.recordTradeClosed(c.pnl, c.at),
  });
  broker.setMarkPrice('B-SOL_USDT', LAST);
  const execution = new ExecutionEngine(broker, store);
  const pending = new Map<string, TradeFeatureSnapshot>();

  execution.setFillHook((tracked) => {
    if (tracked.intentType === 'ENTRY' && tracked.filledQuantity > 0) {
      const snap = pending.get(tracked.intentId);
      if (snap) {
        ledger.recordOpened(snap);
        pending.delete(tracked.intentId);
      }
    }
  });

  const deps: PipelineDeps = {
    provider: fakeProvider(),
    limits: { ...DEFAULT_RISK_LIMITS, minRiskRewardRatio: 2 },
    portfolio: new PortfolioEngine({
      broker: {
        getPositions: async () => [],
        getBalances: async () => [{ currency: 'USDT', total: 10_000, available: 10_000 }],
      } as unknown as PaperExecutionBroker,
      limits: DEFAULT_RISK_LIMITS,
      performance: perf,
    }),
    execution,
    store,
    challengesEnabled: false,
    specFor: async (symbol: string) => FALLBACK_SPEC(symbol.replace(/USDT$/, '')),
    reservations: new RiskReservationManager(store),
    ledger,
    analyze: async () => ({
      symbol: 'SOLUSDT', bias: 'BULLISH', summary: 'structure bullish',
      keyLevels: { support: 100, resistance: 140 }, catalysts: [], risks: [],
    }),
    strategize: async (req) => ({
      action: 'EXECUTE',
      candidateId: req.setups[0]?.id,
      confidence: 0.7,
      thesis: 'take candidate',
      invalidation: 'structure breaks',
    }),
    execute: buildExecutor(broker, undefined, execution),
    registerPendingSnapshot: (s) => pending.set(s.decisionId, s),
    clearPendingSnapshot: (id) => pending.delete(id),
    commitPendingSnapshot: (id) => {
      const snap = pending.get(id);
      if (!snap) return;
      ledger.recordOpened(snap);
      pending.delete(id);
    },
    getLessons: () => [],
  };
  return { deps, ledger, pending };
};

describe('pipeline learning hook — snapshot before sync fill', () => {
  it('records trade.opened when paper broker fills during execute', async () => {
    const { deps, ledger, pending } = makeLearningDeps();
    const trace = await runTradingPipeline(deps, 'SOLUSDT');
    expect(trace.status).toBe('EXECUTED');
    expect(ledger.openTrades).toHaveLength(1);
    expect(ledger.openTrades[0]?.symbol).toBe('SOLUSDT');
    expect(pending.size).toBe(0);
  });

  it('clears pending snapshot when execute fails', async () => {
    const { deps, ledger, pending } = makeLearningDeps();
    deps.execute = async () => { throw new Error('venue down'); };
    const trace = await runTradingPipeline(deps, 'SOLUSDT');
    expect(trace.status).toBe('ERROR');
    expect(ledger.openTrades).toHaveLength(0);
    expect(pending.size).toBe(0);
  });
});
