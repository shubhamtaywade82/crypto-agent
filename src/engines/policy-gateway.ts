import type { TradeProposal } from '../domain/orders/trade-proposal.js';
import { validateProposal } from '../domain/orders/trade-proposal.js';
import type { MarketState } from '../domain/market/types.js';
import type { RiskLimits } from '../domain/risk/risk-config.js';
import { circuitRiskMultiplier, deriveCircuitState } from '../domain/risk/risk-config.js';
import type { PortfolioEngine } from './portfolio-engine.js';
import { clusterOf } from '../domain/portfolio/portfolio-state.js';
import type { ExecutionEngine, TrackedOrder } from './execution-engine.js';
import type { RiskReservationManager } from './risk-reservations.js';
import type { ContractSpec } from '../domain/futures/contract-spec.js';
import type { EventStore } from '../infrastructure/events/event-store.js';
import type { TradeFeatureSnapshot } from '../learning/trade-ledger.js';
import type { SizingResult } from './position-sizer.js';
import { sizePosition } from './position-sizer.js';
import type { RiskDecision } from '../domain/risk/risk-decision.js';
import { evaluateRisk } from './risk-engine.js';
import type { ExecutionIntent } from '../domain/orders/execution-intent.js';
import { buildExecutionIntent } from '../domain/orders/execution-intent.js';

export interface PolicyGatewayDeps {
  readonly limits: RiskLimits;
  readonly portfolio: PortfolioEngine;
  readonly execution: ExecutionEngine;
  readonly reservations: RiskReservationManager;
  readonly specFor: (symbol: string) => Promise<ContractSpec>;
  readonly store: EventStore;
  readonly isTradingAllowed: () => { readonly allowed: boolean; readonly reason?: string };
  readonly crossVenueGate?: (symbol: string) => Promise<{ readonly tradable: boolean; readonly reasons: readonly string[] }>;
  readonly strategyGate?: (strategyId: string, setupType: string, regime: string) => { readonly allowed: boolean; readonly reason?: string };
  readonly registerPendingSnapshot?: (snapshot: TradeFeatureSnapshot) => void;
}

export type GatewayExecutionResult =
  | { readonly ok: true; readonly status: string; readonly intent: ExecutionIntent; readonly order: TrackedOrder }
  | { readonly ok: false; readonly status: string; readonly reasons?: readonly string[]; readonly risk?: RiskDecision; readonly sizing?: SizingResult };

export interface ApprovedTradeIntent {
  readonly decisionId: string;
  readonly proposal: TradeProposal;
  readonly sizing: SizingResult;
  readonly risk: RiskDecision;
  readonly reservationId: string;
  readonly pair: string;
  readonly expectedPrice: number;
  readonly maxSlippageBps: number;
  readonly regime: string;
  readonly fundingRate: number;
  readonly plannedRr: number;
  readonly createdAt: number;
  readonly expiresAt: number;
  state: 'PENDING' | 'CONSUMED' | 'EXPIRED';
}

export type GatewayProposeResult =
  | { readonly ok: true; readonly decisionId: string; readonly approved: true; readonly expiresAt: number; readonly risk: RiskDecision; readonly sizing: SizingResult; readonly validation: ReturnType<typeof validateProposal> }
  | { readonly ok: false; readonly approved: false; readonly status: string; readonly reasons?: readonly string[]; readonly risk?: RiskDecision; readonly sizing?: SizingResult };

const checkGates = async (
  deps: PolicyGatewayDeps,
  proposal: TradeProposal,
  regime: string
): Promise<{ readonly ok: boolean; readonly reasons: readonly string[] }> => {
  const allowed = deps.isTradingAllowed();
  if (!allowed.allowed) return { ok: false, reasons: [allowed.reason ?? 'trading halted'] };
  if (deps.strategyGate) {
    const verdict = deps.strategyGate(proposal.setupType, proposal.setupType, regime);
    if (!verdict.allowed) return { ok: false, reasons: [verdict.reason ?? 'strategy cell not tradable'] };
  }
  if (deps.crossVenueGate) {
    const xGate = await deps.crossVenueGate(proposal.symbol);
    if (!xGate.tradable) return { ok: false, reasons: xGate.reasons };
  }
  return { ok: true, reasons: [] };
};

const settleGatewayReservation = (reservations: RiskReservationManager, id: string, status: string): void => {
  if (status === 'FILLED' || status === 'POSITION_OPEN') reservations.commit(id);
  else if (status === 'REJECTED' || status === 'CANCELLED' || status === 'EXPIRED') reservations.release(id);
};

type GateCheckOutcome =
  | { readonly ok: false; readonly status: string; readonly reasons: readonly string[]; readonly validation: ReturnType<typeof validateProposal> }
  | { readonly ok: true; readonly validation: ReturnType<typeof validateProposal> };

type EvaluatedRiskOutcome = {
  readonly portfolio: ReturnType<PolicyGatewayDeps['portfolio']['peek']>;
  readonly sizing: SizingResult;
  readonly risk: RiskDecision;
};

const validateAndGate = async (
  deps: PolicyGatewayDeps,
  proposal: TradeProposal,
  regime: string
): Promise<GateCheckOutcome> => {
  const validation = validateProposal(proposal, deps.limits.minRiskRewardRatio, deps.limits.maxLeverage);
  if (!validation.valid) {
    deps.store.appendClassified({
      type: 'proposal.invalid', symbol: proposal.symbol, payload: { reasons: validation.reasons },
    });
    return { ok: false, status: 'INVALID_PROPOSAL', reasons: validation.reasons, validation };
  }
  const gateCheck = await checkGates(deps, proposal, regime);
  if (!gateCheck.ok) {
    deps.store.appendClassified({
      type: 'risk.rejected', symbol: proposal.symbol, payload: { reasons: gateCheck.reasons, source: 'policy_gate' },
    });
    return { ok: false, status: 'REJECTED', reasons: gateCheck.reasons, validation };
  }
  return { ok: true, validation };
};

const evaluateProposalRisk = async (
  deps: PolicyGatewayDeps,
  proposal: TradeProposal,
  state: MarketState,
  validation: ReturnType<typeof validateProposal>
): Promise<EvaluatedRiskOutcome> => {
  const spec = await deps.specFor(proposal.symbol);
  const portfolio = deps.portfolio.peek();
  const circuit = deriveCircuitState(
    portfolio.dailyLossPercent, portfolio.drawdownPercent, portfolio.lossStreak, deps.limits
  );
  const sizing = sizePosition({
    equity: portfolio.equity, availableMargin: portfolio.availableMargin ?? portfolio.equity,
    direction: proposal.direction, entry: proposal.entry, stop: proposal.stopLoss,
    requestedLeverage: proposal.leverage, fundingRate: state.futures.fundingRate,
    spec, limits: deps.limits, circuitMultiplier: circuitRiskMultiplier(circuit),
  });
  const risk = evaluateRisk({
    proposal, validation, sizing, portfolio, limits: deps.limits,
    marketStateAgeMs: state.capturedAt ? Date.now() - state.capturedAt : 0,
  });
  deps.store.appendClassified({
    type: risk.approved ? 'risk.approved' : 'risk.rejected',
    symbol: proposal.symbol, decisionId: risk.decisionId,
    payload: { circuitState: risk.circuitState, checks: risk.checks, reasons: risk.reasons },
  });
  return { portfolio, sizing, risk };
};

const submitGatedIntent = async (
  deps: PolicyGatewayDeps,
  intent: ExecutionIntent,
  proposal: TradeProposal,
  sizing: SizingResult
): Promise<TrackedOrder> => {
  deps.execution.registerApproved({
    intentId: intent.intentId, pair: intent.pair, symbol: intent.symbol,
    side: intent.side, quantity: sizing.quantity, reservationId: intent.reservationId,
  });
  const order = await deps.execution.submit(intent.intentId, {
    pair: intent.pair, side: intent.side, orderType: 'market_order',
    quantity: sizing.quantity, leverage: sizing.leverage, marginType: 'isolated',
    stopLoss: proposal.stopLoss, takeProfit: proposal.takeProfit,
    expectedPrice: intent.expectedPrice, maxSlippageBps: intent.maxSlippageBps,
    strategyId: proposal.setupType, decisionId: intent.intentId, intentType: 'ENTRY',
  });
  settleGatewayReservation(deps.reservations, intent.reservationId, order.status);
  return order;
};

interface CreateIntentParams {
  readonly proposal: TradeProposal;
  readonly sizing: SizingResult;
  readonly risk: RiskDecision;
  readonly resvId: string;
  readonly pair: string;
  readonly state: MarketState;
  readonly plannedRr: number;
}

const buildApprovedIntent = (p: CreateIntentParams): ApprovedTradeIntent => {
  const now = Date.now();
  const ttl = Number(process.env.INTENT_TTL_MS ?? 60_000);
  return {
    decisionId: p.risk.decisionId,
    proposal: p.proposal,
    sizing: p.sizing,
    risk: p.risk,
    reservationId: p.resvId,
    pair: p.pair,
    expectedPrice: p.proposal.entry,
    maxSlippageBps: Number(process.env.MAX_SLIPPAGE_BPS ?? 25),
    regime: p.state.regime,
    fundingRate: p.state.futures.fundingRate,
    plannedRr: p.plannedRr,
    createdAt: now,
    expiresAt: now + ttl,
    state: 'PENDING',
  };
};

type VerifyOutcome =
  | { readonly ok: true; readonly intent: ApprovedTradeIntent }
  | { readonly ok: false; readonly status: string; readonly reason: string };

const verifyPendingIntent = (
  intent: ApprovedTradeIntent | undefined,
  decisionId: string,
  isTradingAllowed: () => { readonly allowed: boolean; readonly reason?: string }
): VerifyOutcome => {
  if (!intent) return { ok: false, status: 'NOT_FOUND', reason: `Approved intent ${decisionId} not found` };
  if (intent.state === 'CONSUMED') return { ok: false, status: 'ALREADY_CONSUMED', reason: `Intent ${decisionId} already executed` };
  if (intent.state === 'EXPIRED') return { ok: false, status: 'EXPIRED', reason: `Intent ${decisionId} expired` };
  if (Date.now() > intent.expiresAt) return { ok: false, status: 'EXPIRED', reason: `Intent ${decisionId} expired (TTL exceeded)` };
  const allowed = isTradingAllowed();
  if (!allowed.allowed) return { ok: false, status: 'HALTED', reason: allowed.reason ?? 'Trading is halted' };
  return { ok: true, intent };
};

export class PolicyGateway {
  private readonly intents = new Map<string, ApprovedTradeIntent>();

  constructor(private readonly deps: PolicyGatewayDeps) {}

  async propose(proposal: TradeProposal, state: MarketState, pair: string): Promise<GatewayProposeResult> {
    const gated = await validateAndGate(this.deps, proposal, state.regime);
    if (!gated.ok) return { ok: false, approved: false, status: gated.status, reasons: gated.reasons };

    const { portfolio, sizing, risk } = await evaluateProposalRisk(this.deps, proposal, state, gated.validation);
    if (!risk.approved) return { ok: false, approved: false, status: 'REJECTED', risk, sizing };

    const cluster = clusterOf(proposal.symbol);
    const resv = this.deps.reservations.reserve(portfolio, {
      symbol: proposal.symbol, cluster, notional: sizing.notional,
      riskAmount: sizing.riskAmount, addsPosition: true,
    }, this.deps.limits);
    if (!resv.ok || !resv.reservation) return { ok: false, approved: false, status: 'REJECTED', reasons: [resv.detail] };

    const intent = buildApprovedIntent({
      proposal, sizing, risk, resvId: resv.reservation.id, pair, state, plannedRr: gated.validation.rr,
    });
    this.intents.set(risk.decisionId, intent);
    this.deps.store.appendClassified({
      type: 'intent.approved', symbol: proposal.symbol, decisionId: risk.decisionId,
      payload: { reservationId: resv.reservation.id, pair, expiresAt: intent.expiresAt, notional: sizing.notional },
    });
    this.deps.registerPendingSnapshot?.({
      decisionId: intent.decisionId, symbol: proposal.symbol, strategyId: proposal.setupType,
      direction: proposal.direction, entry: proposal.entry, stopLoss: proposal.stopLoss,
      takeProfit: proposal.takeProfit, plannedRr: gated.validation.rr, regime: state.regime,
      fundingRate: state.futures.fundingRate, leverage: sizing.leverage,
      riskAmount: sizing.riskAmount, notional: sizing.notional,
      confidence: proposal.confidence, openedAt: intent.createdAt,
    });
    return { ok: true, approved: true, decisionId: risk.decisionId, expiresAt: intent.expiresAt, risk, sizing, validation: gated.validation };
  }

  async executeApproved(decisionId: string): Promise<GatewayExecutionResult> {
    const intent = this.intents.get(decisionId);
    const verified = verifyPendingIntent(intent, decisionId, this.deps.isTradingAllowed);
    if (!verified.ok) {
      if (intent && (verified.status === 'EXPIRED' || verified.status === 'HALTED')) {
        intent.state = 'EXPIRED';
        this.deps.reservations.release(intent.reservationId);
      }
      return { ok: false, status: verified.status, reasons: [verified.reason] };
    }
    const approved = verified.intent;
    approved.state = 'CONSUMED';
    const execIntent = buildExecutionIntent({
      pair: approved.pair, proposal: approved.proposal, sizing: approved.sizing, risk: approved.risk,
      reservationId: approved.reservationId, expectedPrice: approved.expectedPrice,
      maxSlippageBps: approved.maxSlippageBps, regime: approved.regime, fundingRate: approved.fundingRate,
    });
    const order = await submitGatedIntent(this.deps, execIntent, approved.proposal, approved.sizing);
    this.deps.store.appendClassified({
      type: 'intent.executed', symbol: approved.proposal.symbol, decisionId,
      payload: { orderId: order.orderId, status: order.status },
    });
    return { ok: true, status: order.status, intent: execIntent, order };
  }

  async execute(proposal: TradeProposal, state: MarketState, pair: string): Promise<GatewayExecutionResult> {
    const proposed = await this.propose(proposal, state, pair);
    if (!proposed.ok) {
      return { ok: false, status: proposed.status, reasons: proposed.reasons, risk: proposed.risk, sizing: proposed.sizing };
    }
    return this.executeApproved(proposed.decisionId);
  }

  getPendingIntent(decisionId: string): ApprovedTradeIntent | undefined {
    return this.intents.get(decisionId);
  }
}
