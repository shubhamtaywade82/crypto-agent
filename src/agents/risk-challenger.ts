import type { MarketState } from '../domain/market/types.js';
import type { TradeProposal } from '../domain/orders/trade-proposal.js';
import type { OllamaClient } from '@nemesis-oss/ollama-sdk';
import { ChallengerVerdictSchema, type ChallengerVerdict } from './schemas.js';
import { CHALLENGER_SYSTEM, challengerPrompt } from './roles.js';
import { runJsonRole } from './role-runner.js';

/**
 * Risk-challenger role: adversarial review recorded in the audit trail.
 * Strictly ADVISORY — the RiskEngine remains the only gate (the
 * challenger can never approve anything, and its objections cannot be
 * overridden by the strategist either).
 */
export const challengeProposal = async (
  ollama: OllamaClient,
  model: string,
  proposal: TradeProposal,
  state: MarketState
): Promise<ChallengerVerdict> =>
  runJsonRole({
    ollama,
    model,
    system: CHALLENGER_SYSTEM,
    user: challengerPrompt(proposal, state),
    schema: ChallengerVerdictSchema,
  });
