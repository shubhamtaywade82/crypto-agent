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

/** Risk-approved path: reserve -> challenge -> execute with reservation lifecycle. */
const proceedToExecution = async (
  deps: PipelineDeps,
  ctx: ApprovedCtx
): Promise<PipelineTrace> => {
  const { assessed, state, portfolio, proposal, sizing, risk } = ctx;
  const reserved = reserveStage({ deps, portfolio, proposal, sizing, risk });
  if (!reserved.ok) return { ...assessed, status: 'REJECTED' };

  const challenge = await challengeStage(deps, proposal, risk, state);

  if (deps.execute) {
    try {
      const order = await deps.execute(proposal, sizing, risk, reserved.reservationId);
      settleReservation(deps.reservations, reserved.reservationId, order.status);
      return {
        ...assessed, challenge, status: 'EXECUTED',
        order: { intentId: risk.decisionId, status: order.status, orderId: order.orderId },
      };
    } catch (err) {
      deps.reservations?.release(reserved.reservationId ?? '', 'RELEASED_EXECUTION_ERROR');
      throw err;
    }
  }
  // Dry-run approval: release the hold so it cannot leak.
  deps.reservations?.release(reserved.reservationId ?? '', 'RELEASED_DRY_RUN');
  return { ...assessed, challenge, status: 'APPROVED' };
};

/**
 * Post-strategy stages: candidate resolution -> structural validation ->
 * assess (spec, size, risk) -> reservation -> challenge -> execution.
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

  const validation = validateProposal(
    proposal, deps.limits.minRiskRewardRatio, deps.limits.maxLeverage
  );
  if (!validation.valid) return invalidProposal(deps, staged, validation);

  const { sizing, risk } = await assessProposal(deps, proposal, state, portfolio);
  const assessed: PipelineTrace = { ...staged, validation, sizing, risk };
  if (!risk.approved) return riskRejected(deps, assessed);

  return proceedToExecution(deps, { assessed, state, portfolio, proposal, sizing, risk });
};
