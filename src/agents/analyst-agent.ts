import type { MarketState } from '../domain/market/types.js';
import type { OllamaClient } from '@nemesis-oss/ollama-sdk';
import { MarketAnalysisSchema, type MarketAnalysis } from './schemas.js';
import { ANALYST_SYSTEM, analystPrompt } from './roles.js';
import { runJsonRole } from './role-runner.js';

/**
 * Analyst role: deterministic MarketState in, structured analysis out.
 * The analyst never sees exchange APIs — only the compiled snapshot —
 * so hallucinated prices are structurally impossible.
 */
export const analyzeMarket = async (
  ollama: OllamaClient,
  model: string,
  state: MarketState
): Promise<MarketAnalysis> =>
  runJsonRole({
    ollama,
    model,
    system: ANALYST_SYSTEM,
    user: analystPrompt(state),
    schema: MarketAnalysisSchema,
  });
