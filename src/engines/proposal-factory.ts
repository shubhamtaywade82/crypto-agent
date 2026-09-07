import type { TradeProposal } from '../domain/orders/trade-proposal.js';
import type { StrategyOutcome } from '../agents/schemas.js';
import type { SetupCandidate } from './setup-engine.js';

export interface CandidateResolution {
  readonly proposal?: TradeProposal;
  readonly unknownCandidateId?: string;
  /** True when levels were resolved server-side from the canonical candidate. */
  readonly candidateLocked: boolean;
}

const proposalFromCandidate = (
  outcome: StrategyOutcome,
  candidate: SetupCandidate,
  fallbackSymbol: string
): TradeProposal => ({
  symbol: candidate.symbol ?? fallbackSymbol,
  direction: candidate.direction,
  entry: candidate.entry,
  stopLoss: candidate.stopLoss,
  takeProfit: candidate.takeProfit,
  orderType: 'MARKET',
  leverage: candidate.leverage,
  setupType: candidate.type ?? outcome.setupType,
  confidence: outcome.confidence,
  thesis: outcome.thesis,
  invalidation: outcome.invalidation,
  source: 'LLM_STRATEGIST',
});

/**
 * Server-side candidate resolution (kernel v3 contract): the strategist
 * references a candidateId; entry/stop/takeProfit/symbol/leverage are
 * taken ONLY from the canonical validated candidate — the model cannot
 * carry (or mutate) trade levels.
 */
export const resolveCandidate = (
  outcome: StrategyOutcome,
  setups: readonly SetupCandidate[],
  fallbackSymbol: string
): CandidateResolution => {
  if (outcome.action !== 'EXECUTE') return { candidateLocked: false };

  const chosen = outcome.candidateId
    ? setups.find((s) => s.id === outcome.candidateId)
    : undefined;
  if (outcome.candidateId && !chosen) {
    return { unknownCandidateId: outcome.candidateId, candidateLocked: false };
  }
  // No candidateId: fall back to the top-ranked candidate (explicitly
  // allowed: "select one or wait").
  const base = chosen ?? setups[0];
  if (!base) return { candidateLocked: false };
  return {
    candidateLocked: true,
    proposal: proposalFromCandidate(outcome, base, fallbackSymbol),
  };
};
