import type { OllamaClient } from '@nemesis-oss/ollama-sdk';
import { StrategyOutcomeSchema, type StrategyOutcome } from './schemas.js';
import { STRATEGIST_SYSTEM, strategistPrompt, type StrategistContext } from './roles.js';
import { runJsonRole } from './role-runner.js';

/**
 * Strategist role: picks among ALREADY-VALIDATED candidate setups
 * (or stands down). It cannot invent risk parameters that bypass the
 * kernel: any explicit levels it returns are re-validated by the
 * TradeValidator + RiskEngine like every other proposal.
 */
export const strategize = async (
  ollama: OllamaClient,
  model: string,
  ctx: StrategistContext
): Promise<StrategyOutcome> =>
  runJsonRole({
    ollama,
    model,
    system: STRATEGIST_SYSTEM,
    user: strategistPrompt(ctx),
    schema: StrategyOutcomeSchema,
  });
