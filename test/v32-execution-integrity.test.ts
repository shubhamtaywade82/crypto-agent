import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EventStore } from '../src/infrastructure/events/event-store.js';
import { PaperExecutionBroker } from '../src/infrastructure/paper/paper-broker-adapter.js';
import { ExecutionEngine } from '../src/engines/execution-engine.js';
import { Reconciler } from '../src/engines/reconciler.js';
import { RiskReservationManager } from '../src/engines/risk-reservations.js';
import { PolicyGateway } from '../src/engines/policy-gateway.js';
import { buildExecutionIntent } from '../src/domain/orders/execution-intent.js';
import { PortfolioEngine } from '../src/engines/portfolio-engine.js';
import { TradeLedger, type TradeFeatureSnapshot } from '../src/learning/trade-ledger.js';
import { DEFAULT_RISK_LIMITS } from '../src/domain/risk/risk-config.js';
import type { TradeProposal } from '../src/domain/orders/trade-proposal.js';
import type { MarketState } from '../src/domain/market/types.js';
import { FALLBACK_SPEC } from '../src/domain/futures/contract-spec.js';

const makeStore = (): EventStore =>
  new EventStore(join(mkdtempSync(join(tmpdir(), 'v32-store-')), 'events.jsonl'));

const mockState = (last = 100): MarketState => ({
  symbol: 'SOLUSDT',
  capturedAt: Date.now(),
  price: { last, mark: last, index: last },
  regime: 'TREND_UP',
  btcRegime: 'TREND_UP',
  timeframes: {} as any,
  liquidity: { nearestHigh: 110, nearestLow: 90, sweepDetected: false, sweepSide: 'NONE' },
  futures: { fundingRate: 0.0001, openInterest: 1000, openInterestChange: 0, markPrice: last, indexPrice: last },
});

describe('V3.2 P0 Execution & Control-Plane Integrity', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  describe('P0-1: Authoritative PolicyGateway', () => {
    it('executes valid proposal through sizing, risk, reservation, and submission', async () => {
      const store = makeStore();
      const broker = new PaperExecutionBroker({ initialBalance: 10_000 });
      broker.setMarkPrice('B-SOL_USDT', 100);
      const execution = new ExecutionEngine(broker, store);
      const reservations = new RiskReservationManager(store);
      const portfolio = new PortfolioEngine({ broker, limits: DEFAULT_RISK_LIMITS, fallbackEquity: 10_000 });
      await portfolio.refresh();

      let registeredSnapshot: TradeFeatureSnapshot | undefined;
      const gateway = new PolicyGateway({
        limits: DEFAULT_RISK_LIMITS,
        portfolio,
        execution,
        reservations,
        specFor: async () => FALLBACK_SPEC('SOL'),
        store,
        isTradingAllowed: () => ({ allowed: true }),
        registerPendingSnapshot: (s) => { registeredSnapshot = s; },
      });

      const proposal: TradeProposal = {
        symbol: 'SOLUSDT', direction: 'LONG', entry: 100, stopLoss: 98, takeProfit: 106,
        orderType: 'MARKET', leverage: 2, setupType: 'TEST_PULLBACK',
        confidence: 0.8, thesis: 'test', invalidation: 'stop 98', source: 'LLM_STRATEGIST',
      };

      const result = await gateway.execute(proposal, mockState(100), 'B-SOL_USDT');
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.status).toBe('FILLED');
        expect(result.intent.reservationId).toBeDefined();
        expect(result.order.reservationId).toBe(result.intent.reservationId);
        expect(registeredSnapshot?.decisionId).toBe(result.intent.intentId);
      }
    });

    it('rejects invalid proposal geometry without placing order or reservation', async () => {
      const store = makeStore();
      const broker = new PaperExecutionBroker({ initialBalance: 10_000 });
      const execution = new ExecutionEngine(broker, store);
      const reservations = new RiskReservationManager(store);
      const portfolio = new PortfolioEngine({ broker, limits: DEFAULT_RISK_LIMITS, fallbackEquity: 10_000 });

      const gateway = new PolicyGateway({
        limits: DEFAULT_RISK_LIMITS,
        portfolio,
        execution,
        reservations,
        specFor: async () => FALLBACK_SPEC('SOL'),
        store,
        isTradingAllowed: () => ({ allowed: true }),
      });

      const badProposal: TradeProposal = {
        symbol: 'SOLUSDT', direction: 'LONG', entry: 100, stopLoss: 102, takeProfit: 106,
        orderType: 'MARKET', leverage: 2, setupType: 'TEST',
        confidence: 0.8, thesis: 'bad', invalidation: 'stop', source: 'LLM_STRATEGIST',
      };

      const result = await gateway.execute(badProposal, mockState(100), 'B-SOL_USDT');
      expect(result.ok).toBe(false);
      expect(result.status).toBe('INVALID_PROPOSAL');
      expect(reservations.active()).toHaveLength(0);
      expect(execution.listOpen()).toHaveLength(0);
    });

    it('blocks execution when kill switch halts trading', async () => {
      const store = makeStore();
      const broker = new PaperExecutionBroker({ initialBalance: 10_000 });
      const execution = new ExecutionEngine(broker, store);
      const reservations = new RiskReservationManager(store);
      const portfolio = new PortfolioEngine({ broker, limits: DEFAULT_RISK_LIMITS, fallbackEquity: 10_000 });

      const gateway = new PolicyGateway({
        limits: DEFAULT_RISK_LIMITS,
        portfolio,
        execution,
        reservations,
        specFor: async () => FALLBACK_SPEC('SOL'),
        store,
        isTradingAllowed: () => ({ allowed: false, reason: 'kill switch HALTED' }),
      });

      const proposal: TradeProposal = {
        symbol: 'SOLUSDT', direction: 'LONG', entry: 100, stopLoss: 98, takeProfit: 106,
        orderType: 'MARKET', leverage: 2, setupType: 'TEST',
        confidence: 0.8, thesis: 'test', invalidation: 'stop', source: 'LLM_STRATEGIST',
      };

      const result = await gateway.execute(proposal, mockState(100), 'B-SOL_USDT');
      expect(result.ok).toBe(false);
      expect(result.status).toBe('REJECTED');
      expect(result.reasons?.[0]).toContain('kill switch HALTED');
    });
  });

  describe('P0-2: Immutable ExecutionIntent', () => {
    it('creates a frozen execution intent with valid invariants', () => {
      const intent = buildExecutionIntent({
        pair: 'B-SOL_USDT',
        proposal: {
          symbol: 'SOLUSDT', direction: 'LONG', entry: 100, stopLoss: 98, takeProfit: 106,
          orderType: 'MARKET', leverage: 2, setupType: 'TEST',
          confidence: 0.8, thesis: 'test', invalidation: 'stop', source: 'LLM_STRATEGIST',
        },
        sizing: {
          ok: true, quantity: 1, notional: 100, marginRequired: 50, leverage: 2,
          riskAmount: 2, effectiveRiskPerUnit: 2, feePerUnit: 0.05, fundingPerUnit: 0.01, warnings: [],
        },
        risk: {
          approved: true, decisionId: 'dec-123', circuitState: 'NORMAL',
          checks: [], rejections: [], reasons: [], timestamp: Date.now(),
        },
        reservationId: 'resv-123',
        expectedPrice: 100,
        maxSlippageBps: 25,
        regime: 'TREND_UP',
        fundingRate: 0.0001,
      });

      expect(Object.isFrozen(intent)).toBe(true);
      expect(intent.intentId).toBe('dec-123');
      expect(intent.reservationId).toBe('resv-123');
      expect(() => { (intent as any).expectedPrice = 200; }).toThrow();
    });

    it('throws when expectedPrice is non-positive', () => {
      expect(() =>
        buildExecutionIntent({
          pair: 'B-SOL_USDT',
          proposal: {} as any,
          sizing: {} as any,
          risk: { decisionId: 'dec-1' } as any,
          reservationId: 'resv-1',
          expectedPrice: 0,
          maxSlippageBps: 25,
          regime: 'TREND_UP',
          fundingRate: 0.0001,
        })
      ).toThrow('Invalid expectedPrice');
    });
  });

  describe('P0-3: Submission Durability & Restart Truth', () => {
    it('persists order.submission_intent and revives crashed submission as UNKNOWN', () => {
      const store = makeStore();
      const broker = new PaperExecutionBroker({ initialBalance: 10_000 });
      const engineA = new ExecutionEngine(broker, store);

      engineA.registerApproved({
        intentId: 'intent-crash-1', pair: 'B-SOL_USDT', symbol: 'SOLUSDT',
        side: 'buy', quantity: 1, reservationId: 'resv-c1',
      });

      // Submit appends submission_intent before network request
      const submitPromise = engineA.submit('intent-crash-1', {
        pair: 'B-SOL_USDT', side: 'buy', orderType: 'market_order',
        quantity: 1, leverage: 2, marginType: 'isolated',
      });
      submitPromise.catch(() => undefined);

      const events = store.readAll(50);
      expect(events.some((e) => e.type === 'order.submission_intent')).toBe(true);

      // Simulate crash and restart on fresh engine
      const engineB = new ExecutionEngine(broker, store);
      engineB.hydrate();
      const revived = engineB.get('intent-crash-1');
      expect(revived).toBeDefined();
      expect(revived?.status).toBe('UNKNOWN');
      expect(revived?.reservationId).toBe('resv-c1');
    });
  });

  describe('P0-4: UNKNOWN Reservation Settlement via Reconciler', () => {
    it('retains reservation during UNKNOWN and releases when reconciler confirms missing', async () => {
      const store = makeStore();
      const broker = new PaperExecutionBroker({ initialBalance: 10_000 });
      const engine = new ExecutionEngine(broker, store);
      const reservations = new RiskReservationManager(store);
      const portfolio: any = { equity: 10_000, openPositions: 0, grossExposure: 0, exposures: [] };

      const check = reservations.reserve(portfolio, {
        symbol: 'SOLUSDT', cluster: 'alts', notional: 100, riskAmount: 2, addsPosition: true,
      }, DEFAULT_RISK_LIMITS);
      expect(check.ok).toBe(true);
      const resvId = check.reservation!.id;

      engine.registerApproved({
        intentId: 'intent-unknown-resv', pair: 'B-SOL_USDT', symbol: 'SOLUSDT',
        side: 'buy', quantity: 1, reservationId: resvId,
      });
      engine.transition(engine.get('intent-unknown-resv')!, 'SUBMITTING');
      engine.transition(engine.get('intent-unknown-resv')!, 'UNKNOWN');

      // Reservation must remain ACTIVE while order is UNKNOWN
      expect(reservations.get(resvId)?.state).toBe('ACTIVE');

      // Reconciler checks venue: order missing broker-side -> CANCELLED -> releases reservation
      const reconciler = new Reconciler(broker, engine, store, reservations);
      const report = await reconciler.reconcile();
      expect(report.repaired).toBe(1);
      expect(engine.get('intent-unknown-resv')?.status).toBe('CANCELLED');
      expect(reservations.get(resvId)?.state).toBe('RELEASED');
    });

    it('commits reservation when reconciler confirms order is FILLED', async () => {
      const store = makeStore();
      const broker = new PaperExecutionBroker({ initialBalance: 10_000 });
      broker.setMarkPrice('B-SOL_USDT', 100);
      const engine = new ExecutionEngine(broker, store);
      const reservations = new RiskReservationManager(store);
      const portfolio: any = { equity: 10_000, openPositions: 0, grossExposure: 0, exposures: [] };

      const check = reservations.reserve(portfolio, {
        symbol: 'SOLUSDT', cluster: 'alts', notional: 100, riskAmount: 2, addsPosition: true,
      }, DEFAULT_RISK_LIMITS);
      const resvId = check.reservation!.id;

      // Place actual order on broker directly so it exists
      const brokerOrder = await broker.placeOrder({
        pair: 'B-SOL_USDT', side: 'buy', orderType: 'market_order',
        quantity: 1, intentId: 'intent-fill-resv',
      });

      // Internal order went to UNKNOWN (e.g. timeout)
      engine.registerApproved({
        intentId: 'intent-fill-resv', pair: 'B-SOL_USDT', symbol: 'SOLUSDT',
        side: 'buy', quantity: 1, reservationId: resvId,
      });
      engine.transition(engine.get('intent-fill-resv')!, 'SUBMITTING');
      engine.transition(engine.get('intent-fill-resv')!, 'UNKNOWN');

      const reconciler = new Reconciler(broker, engine, store, reservations);
      await reconciler.reconcile();

      expect(['FILLED', 'POSITION_OPEN']).toContain(engine.get('intent-fill-resv')?.status);
      expect(reservations.get(resvId)?.state).toBe('COMMITTED');
    });
  });

  describe('P0-5: Confirmed-Fill-Based Trade Opening', () => {
    it('only records trade.opened when fill quantity > 0, not upon submit', async () => {
      const store = makeStore();
      const ledger = new TradeLedger(store);
      const broker = new PaperExecutionBroker({ initialBalance: 10_000 });
      broker.setMarkPrice('B-SOL_USDT', 100);
      const engine = new ExecutionEngine(broker, store);
      const pendingSnapshots = new Map<string, TradeFeatureSnapshot>();

      engine.setFillHook((tracked, at) => {
        if (tracked.intentType === 'ENTRY' && tracked.filledQuantity > 0) {
          const snap = pendingSnapshots.get(tracked.intentId);
          if (snap) {
            ledger.recordOpened(snap);
            pendingSnapshots.delete(tracked.intentId);
          }
        }
      });

      const snapshot: TradeFeatureSnapshot = {
        decisionId: 'trade-fill-1', symbol: 'SOLUSDT', strategyId: 'TEST',
        direction: 'LONG', entry: 100, stopLoss: 98, takeProfit: 106,
        plannedRr: 3, regime: 'TREND_UP', fundingRate: 0.0001, leverage: 2,
        riskAmount: 2, notional: 100, confidence: 0.8, openedAt: Date.now(),
      };

      // 1. Order registered & pending snapshot set: NOT yet in ledger
      engine.registerApproved({
        intentId: 'trade-fill-1', pair: 'B-SOL_USDT', symbol: 'SOLUSDT',
        side: 'buy', quantity: 1,
      });
      pendingSnapshots.set('trade-fill-1', snapshot);
      expect(ledger.openTrades).toHaveLength(0);

      // 2. Submit executed and filled -> fill hook fires -> recorded in ledger
      await engine.submit('trade-fill-1', {
        pair: 'B-SOL_USDT', side: 'buy', orderType: 'market_order',
        quantity: 1, leverage: 2, marginType: 'isolated',
      });

      expect(ledger.openTrades).toHaveLength(1);
      expect(ledger.openTrades[0].decisionId).toBe('trade-fill-1');
      expect(pendingSnapshots.has('trade-fill-1')).toBe(false);
    });
  });
});
