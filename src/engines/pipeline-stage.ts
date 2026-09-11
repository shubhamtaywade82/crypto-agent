import type { MarketState } from '../domain/market/types.js';
import type { TradeProposal, ValidationResult } from '../domain/orders/trade-proposal.js';
import { validateProposal } from '../domain/orders/trade-proposal.js';
import type { PortfolioState } from '../domain/portfolio/portfolio-state.js';
import { clusterOf } from '../domain/portfolio/portfolio-state.js';
import type { RiskDecision } from '../domain/risk/risk-decision.js';
import type { SizingResult } from './position-sizer.js';
import { assessProposal, type PipelineDeps, type PipelineTrace } from './pipeline.js';
import { resolveCandidate } from './proposal-factory.js';
import type { ChallengerVerdict, StrategyOutcome } from '../agents/schemas.js';
import type { SetupCandidate } from './setup-engine.js';
import type { RiskReservationManager } from './risk-reservations.js';
import { computeRr } from '../domain/orders/trade-proposal.js';

export interface StageArgs {
  readonly trace: PipelineTrace & { outcome: StrategyOutcome };
  readonly state: MarketState;
  readonly outcome: StrategyOutcome;
  readonly setups: readonly SetupCandidate[];
  readonly portfolio: PortfolioState;
}

/** EXECUTE referencing a candidate that does not exist, or none resolvable. */
const invalidCandidate = (
  deps: PipelineDeps,
  trace: PipelineTrace,
  unknownCandidateId?: string
): PipelineTrace => {
  const reason = unknownCandidateId
    ? `unknown candidateId ${unknownCandidateId}`
    : 'EXECUTE without a resolvable candidate';
  deps.store.append({ type: 'proposal.invalid', symbol: trace.symbol, payload: { reason } });
  return { ...trace, status: 'INVALID_PROPOSAL' };
};

/** Structural validation is its own status, distinct from risk rejection. */
const invalidProposal = (
  deps: PipelineDeps,
  staged: PipelineTrace,
  validation: ValidationResult
): PipelineTrace => {
  deps.store.append({
    type: 'proposal.invalid', symbol: staged.proposal!.symbol,
    payload: { reasons: validation.reasons },
  });
  return { ...staged, validation, status: 'INVALID_PROPOSAL' };
};

const riskRejected = (deps: PipelineDeps, assessed: PipelineTrace): PipelineTrace => {
  const { risk, proposal } = assessed;
  deps.store.append({
    type: 'risk.rejected', symbol: proposal!.symbol, decisionId: risk!.decisionId,
    payload: { reasons: risk!.reasons, rejections: risk!.rejections },
  });
  return { ...assessed, status: 'REJECTED' };
};

interface ReserveOutcome {
  readonly ok: boolean;
  readonly reservationId?: string;
}

interface ReserveStageInput {
  readonly deps: PipelineDeps;
  readonly portfolio: PortfolioState;
  readonly proposal: TradeProposal;
  readonly sizing: SizingResult;
  readonly risk: RiskDecision;
}

/** Reserve global risk after approval; declines if concurrent lanes filled the budget. */
const reserveStage = (input: ReserveStageInput): ReserveOutcome => {
  const { deps, portfolio, proposal, sizing, risk } = input;
  if (!deps.reservations) return { ok: true };
  const resv = deps.reservations.reserve(portfolio, {
    symbol: proposal.symbol,
    cluster: clusterOf(proposal.symbol),
    notional: sizing.notional,
    riskAmount: sizing.riskAmount,
    addsPosition: true,
  }, deps.limits);
  if (!resv.ok || !resv.reservation) {
    deps.store.append({
      type: 'risk.rejected', symbol: proposal.symbol, decisionId: risk.decisionId,
      payload: { reasons: [resv.detail], rejections: resv.rejections, source: 'reservation' },
    });
    return { ok: false };
  }
  return { ok: true, reservationId: resv.reservation.id };
};

const settleReservation = (
  manager: RiskReservationManager | undefined,
  reservationId: string | undefined,
  status: string
): void => {
  if (!manager || !reservationId) return;
  if (status === 'FILLED' || status === 'POSITION_OPEN' || status === 'PROTECTED') {
    manager.commit(reservationId);
  } else if (status === 'REJECTED' || status === 'CANCELLED' || status === 'EXPIRED') {
    manager.release(reservationId);
  }
  // SUBMITTED / ACKNOWLEDGED / PARTIALLY_FILLED / UNKNOWN: keep the hold
  // active — exposure may still materialize; TTL + reconciler settle it.
};

/** Challenge is advisory: verdict + objections are recorded, never binding. */
const challengeStage = async (
  deps: PipelineDeps,
  proposal: TradeProposal,
  risk: RiskDecision,
  state: MarketState
): Promise<ChallengerVerdict | undefined> => {
  if (!deps.challengesEnabled || !deps.challenge) return undefined;
  const verdict = await deps.challenge(proposal, state);
  deps.store.append({
    type: 'risk.challenge', symbol: proposal.symbol, decisionId: risk.decisionId,
    payload: { verdict: verdict.verdict, objections: verdict.objections },
  });
  return verdict;
};

interface ApprovedCtx {
  readonly assessed: PipelineTrace;
  readonly state: MarketState;
  readonly portfolio: PortfolioState;
  readonly proposal: TradeProposal;
  readonly sizing: SizingResult;
  readonly risk: RiskDecision;
}

/**
 * Learning hook: persist the trade's FEATURE SNAPSHOT at execution time
 * (setup, regime, planned R:R, funding, sizing facts, confidence). The
 * outcome is attributed back through the same decisionId when the
 * position realizes — the raw material for per-cell statistics.
 */
const recordTradeOpened = (
  deps: PipelineDeps,
  ctx: ApprovedCtx
): void => {
  const { proposal, sizing, risk, state } = ctx;
  const snapshot = {
    decisionId: risk.decisionId,
    symbol: proposal.symbol,
    strategyId: proposal.setupType,
    direction: proposal.direction,
    entry: proposal.entry,
    stopLoss: proposal.stopLoss,
    takeProfit: proposal.takeProfit,
    plannedRr: computeRr(proposal).rr,
    regime: state.regime,
    fundingRate: state.futures.fundingRate,
    leverage: sizing.leverage,
    riskAmount: sizing.riskAmount,
    notional: sizing.notional,
    confidence: proposal.confidence,
    openedAt: Date.now(),
  };
  if (deps.registerPendingSnapshot) {
    deps.registerPendingSnapshot(snapshot);
  } else if (deps.ledger) {
    deps.ledger.recordOpened(snapshot);
  }
};

/** Cross-venue gate: reject with audited reasons when venues disagree too much. */
const crossVenueStage = async (
  deps: PipelineDeps,
  proposal: TradeProposal,
  risk: RiskDecision
): Promise<boolean> => {
  if (!deps.crossVenueGate) return true;
  const verdict = await deps.crossVenueGate(proposal.symbol);
  if (verdict.tradable) return true;
  deps.store.append({
    type: 'risk.rejected', symbol: proposal.symbol, decisionId: risk.decisionId,
    payload: { reasons: verdict.reasons, source: 'cross_venue' },
  });
  return false;
};

/** Risk-approved path: reserve -> challenge -> execute with reservation lifecycle. */
const proceedToExecution = async (
  deps: PipelineDeps,
  ctx: ApprovedCtx
): Promise<PipelineTrace> => {
  const { assessed, state, portfolio, proposal, sizing, risk } = ctx;
  if (!(await crossVenueStage(deps, proposal, risk))) {
    return { ...assessed, status: 'REJECTED' };
  }
  const reserved = reserveStage({ deps, portfolio, proposal, sizing, risk });
  if (!reserved.ok) return { ...assessed, status: 'REJECTED' };

  const challenge = await challengeStage(deps, proposal, risk, state);

  if (deps.execute) {
    recordTradeOpened(deps, ctx);
    try {
      const order = await deps.execute(proposal, sizing, risk, reserved.reservationId);
      if (order.filledQuantity > 0) deps.commitPendingSnapshot?.(risk.decisionId);
      settleReservation(deps.reservations, reserved.reservationId, order.status);
      return {
        ...assessed, challenge, status: 'EXECUTED',
        order: { intentId: risk.decisionId, status: order.status, orderId: order.orderId },
      };
    } catch (err) {
      deps.clearPendingSnapshot?.(risk.decisionId);
      const tracked = deps.execution?.get(risk.decisionId);
      if (!tracked || tracked.status !== 'UNKNOWN') {
        deps.reservations?.release(reserved.reservationId ?? '', 'RELEASED_EXECUTION_ERROR');
      }
      throw err;
    }
  }
  // Dry-run approval: release the hold so it cannot leak.
  deps.reservations?.release(reserved.reservationId ?? '', 'RELEASED_DRY_RUN');
  return { ...assessed, challenge, status: 'APPROVED' };
};

const auditReject = (
  deps: PipelineDeps,
  trace: PipelineTrace,
  type: string,
  payload: Record<string, unknown>
): false => {
  deps.store.append({ type, symbol: trace.symbol, payload });
  return false;
};

/** Strategy + empirical-evidence gates before sizing. */
export const strategyCellStage = async (
  deps: PipelineDeps,
  trace: PipelineTrace,
  proposal: TradeProposal,
  regime: string
): Promise<boolean> => {
  if (deps.strategyGate) {
    const cell = deps.strategyGate(proposal.setupType, proposal.setupType, regime);
    if (!cell.allowed) {
      return auditReject(deps, trace, 'strategy.cell_rejected', {
        strategyId: proposal.setupType, cell: `${proposal.setupType}|${regime}`,
        reason: cell.reason ?? 'cell not approved',
      });
    }
  }
  if (!deps.evidenceGate) return true;
  const ev = await deps.evidenceGate(trace.symbol, proposal.setupType);
  if (ev.allowed) return true;
  return auditReject(deps, trace, 'evidence.rejected', {
    setupType: proposal.setupType, reason: ev.reason ?? 'evidence gate',
  });
};

/**
 * Post-strategy stages: candidate resolution -> strategy-cell gate ->
 * structural validation -> assess (spec, size, risk) -> reservation ->
 * challenge -> execution.
 */
export const stageExecution = async (
  deps: PipelineDeps,
  args: StageArgs
): Promise<PipelineTrace> => {
  const { trace, state, outcome, setups, portfolio } = args;

  // Server-side candidate resolution (candidateId -> canonical proposal).
  const resolution = resolveCandidate(outcome, setups, trace.symbol);
  if (!resolution.proposal) {
    return invalidCandidate(deps, trace, resolution.unknownCandidateId);
  }
  const proposal = resolution.proposal;
  const staged: PipelineTrace = { ...trace, proposal };

  // Research gate: ACTIVE strategy AND approved (setup × regime) cell.
  if (!(await strategyCellStage(deps, staged, proposal, state.regime))) {
    return { ...staged, status: 'REJECTED' };
  }

  const validation = validateProposal(
    proposal, deps.limits.minRiskRewardRatio, deps.limits.maxLeverage
  );
  if (!validation.valid) return invalidProposal(deps, staged, validation);

  const { sizing, risk } = await assessProposal(deps, proposal, state, portfolio);
  const assessed: PipelineTrace = { ...staged, validation, sizing, risk };
  if (!risk.approved) return riskRejected(deps, assessed);

  return proceedToExecution(deps, { assessed, state, portfolio, proposal, sizing, risk });
};
