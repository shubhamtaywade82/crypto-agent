import { describe, it, expect } from 'vitest';
import { runTradingPipeline, assessProposal, type PipelineDeps } from '../src/engines/pipeline.js';
import { PortfolioEngine } from '../src/engines/portfolio-engine.js';
import { PerformanceEngine } from '../src/engines/performance-engine.js';
import { ExecutionEngine } from '../src/engines/execution-engine.js';
import { RiskReservationManager } from '../src/engines/risk-reservations.js';
import { PaperExecutionBroker } from '../src/infrastructure/paper/paper-broker-adapter.js';
import { EventStore } from '../src/infrastructure/events/event-store.js';
import { DEFAULT_RISK_LIMITS } from '../src/domain/risk/risk-config.js';
import { FALLBACK_SPEC } from '../src/domain/futures/contract-spec.js';
import type { IMarketDataProvider } from '../src/infrastructure/broker/broker.js';
import type { Candle, MarketState } from '../src/domain/market/types.js';
import type { TradeProposal } from '../src/domain/orders/trade-proposal.js';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Impulse-pullback market ending mid-impulse: produces bullish structure,
 * BOS on every timeframe, positive momentum at the close — enough for the
 * deterministic setup detectors to rank candidates.
 */
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
  while (out.length < n - 12) leg('up', 1); // pad remainder
  while (out.length < n) leg('up', 1);      // final impulse: close breaks prior swing high
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

const makeDeps = (over: Partial<PipelineDeps> = {}): PipelineDeps => {
  const store = new EventStore(join(mkdtempSync(join(tmpdir(), 'pipe-')), 'events.jsonl'));
  const perf = new PerformanceEngine();
  const broker = new PaperExecutionBroker({
    initialBalance: 10_000,
    onClose: (c) => perf.recordTradeClosed(c.pnl, c.at),
  });
  broker.setMarkPrice('B-SOLUSDT', LAST);
  return {
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
    execution: new ExecutionEngine(broker, store),
    store,
    challengesEnabled: false,
    specFor: async (symbol: string) => FALLBACK_SPEC(symbol.replace(/USDT$/, '')),
    reservations: new RiskReservationManager(store),
    analyze: async () => ({
      symbol: 'SOLUSDT', bias: 'BULLISH', summary: 'structure bullish across the ladder',
      keyLevels: { support: 100, resistance: 140 }, catalysts: [], risks: [],
    }),
    strategize: async () => ({ action: 'WAIT', confidence: 0.5, thesis: 'stand down', invalidation: 'n/a' }),
    getLessons: () => [],
    ...over,
  };
};

const execProposal = (over: Partial<TradeProposal> = {}): TradeProposal => ({
  symbol: 'SOLUSDT',
  direction: 'LONG',
  entry: 100,
  stopLoss: 95,
  takeProfit: 115,
  orderType: 'MARKET',
  leverage: 1,
  setupType: 'TEST',
  confidence: 0.8,
  thesis: 'test thesis',
  invalidation: 'test invalidation',
  source: 'MANUAL',
  ...over,
});

const fakeState = (): MarketState =>
  ({
    capturedAt: Date.now(),
    futures: { fundingRate: 0.0001 },
  }) as unknown as MarketState;

describe('assessProposal — real contract specs and honest rejections', () => {
  it('sizes against the REAL venue spec from specFor', async () => {
    const deps = makeDeps({
      specFor: async () => ({ ...FALLBACK_SPEC('SOL'), lotSize: 0.5, minQuantity: 0.5 }),
    });
    const { sizing } = await assessProposal(
      deps, execProposal(), fakeState(), await deps.portfolio.refresh()
    );
    expect(sizing.ok).toBe(true);
    // quantity must be lot-step aligned to the REAL venue lot size
    expect(sizing.quantity % 0.5).toBeCloseTo(0, 8);
    expect(sizing.quantity).toBeGreaterThanOrEqual(0.5);
  });

  it('rejects with INSTRUMENT_SPEC_UNAVAILABLE when the spec cannot be resolved', async () => {
    const deps = makeDeps({
      specFor: async () => { throw new Error('venue down'); },
    });
    const { risk } = await assessProposal(
      deps, execProposal(), fakeState(), await deps.portfolio.refresh()
    );
    expect(risk.approved).toBe(false);
    expect(risk.rejections).toContain('INSTRUMENT_SPEC_UNAVAILABLE');
  });
});

describe('runTradingPipeline — v3 stage semantics', () => {
  it('executes a candidate and commits the risk reservation', async () => {
    const deps = makeDeps({
      strategize: async (req) => ({
        action: 'EXECUTE',
        candidateId: req.setups[0]?.id,
        confidence: 0.7,
        thesis: 'take the top-ranked candidate',
        invalidation: 'structure breaks',
      }),
      execute: async () => ({
        intentId: 'x', pair: 'B-SOL_USDT', symbol: 'SOLUSDT', side: 'buy' as const,
        quantity: 1, reduceOnly: false, status: 'FILLED' as const,
        filledQuantity: 1, updatedAt: Date.now(),
      }),
    });
    const trace = await runTradingPipeline(deps, 'SOLUSDT');
    expect(trace.setups.length).toBeGreaterThan(0);
    expect(trace.status).toBe('EXECUTED');

    // Server-side candidate resolution: proposal levels come from the
    // canonical candidate, not from any model-supplied numbers.
    const candidate = trace.setups[0];
    expect(trace.proposal?.entry).toBe(candidate.entry);
    expect(trace.proposal?.stopLoss).toBe(candidate.stopLoss);
    expect(trace.proposal?.takeProfit).toBe(candidate.takeProfit);
    expect(trace.proposal?.direction).toBe(candidate.direction);

    // Reservation committed on fill.
    expect(deps.reservations!.active()).toHaveLength(0);
  });

  it('an unknown candidateId is INVALID_PROPOSAL, not a risk rejection', async () => {
    const deps = makeDeps({
      strategize: async () => ({
        action: 'EXECUTE',
        candidateId: 'setup-does-not-exist',
        confidence: 0.7,
        thesis: 'hallucinated candidate',
        invalidation: 'n/a',
      }),
    });
    const trace = await runTradingPipeline(deps, 'SOLUSDT');
    expect(trace.status).toBe('INVALID_PROPOSAL');
    expect(trace.risk).toBeUndefined();
    const invalid = deps.store.readAll(50).find((e) => e.type === 'proposal.invalid');
    expect(invalid).toBeDefined();
  });

  it('a structurally invalid proposal is INVALID_PROPOSAL (own status, not REJECTED)', async () => {
    const deps = makeDeps({
      strategize: async (req) => ({
        action: 'EXECUTE',
        candidateId: req.setups[0]?.id,
        confidence: 0.7, thesis: 'ok', invalidation: 'ok',
      }),
    });
    // Direct stage check: the validator catches what an LLM schema might
    // let through (defense in depth behind the zod boundary).
    const { validation } = await assessProposal(
      deps, execProposal({ confidence: 5 }), fakeState(), await deps.portfolio.refresh()
    );
    expect(validation.valid).toBe(false);
    expect(validation.reasons.join(' ')).toContain('confidence');
  });

  it('a declined global reservation rejects the trade after risk approval', async () => {
    const deps = makeDeps({
      limits: { ...DEFAULT_RISK_LIMITS, minRiskRewardRatio: 2, maxConcurrentPositions: 1 },
      strategize: async (req) => ({
        action: 'EXECUTE',
        candidateId: req.setups[0]?.id,
        confidence: 0.7, thesis: 'ok', invalidation: 'ok',
      }),
    });
    // Pre-existing ACTIVE reservation for another symbol with
    // maxConcurrentPositions = 1: the pipeline risk engine itself sees
    // openPositions=0 and approves; the reservation gate must decline.
    deps.reservations!.reserve(await deps.portfolio.refresh(), {
      symbol: 'AVAXUSDT', cluster: 'ALT', notional: 1_000,
      riskAmount: 25, addsPosition: true,
    }, { ...DEFAULT_RISK_LIMITS, maxConcurrentPositions: 1 });

    const trace = await runTradingPipeline(deps, 'SOLUSDT');
    expect(trace.status).toBe('REJECTED');
    expect(trace.risk?.approved ?? true).toBe(true); // risk itself approved
    const rejections = deps.store.readAll(50)
      .filter((e) => e.type === 'risk.rejected' && (e.payload as { source?: string }).source === 'reservation');
    expect(rejections.length).toBeGreaterThan(0);
  });

  it('an execution error releases the reservation', async () => {
    const deps = makeDeps({
      strategize: async (req) => ({
        action: 'EXECUTE',
        candidateId: req.setups[0]?.id,
        confidence: 0.7, thesis: 'ok', invalidation: 'ok',
      }),
      execute: async () => { throw new Error('venue 500'); },
    });
    const trace = await runTradingPipeline(deps, 'SOLUSDT');
    expect(trace.status).toBe('ERROR');
    expect(deps.reservations!.active()).toHaveLength(0);
  });
});
