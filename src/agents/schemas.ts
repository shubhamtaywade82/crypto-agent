import { z } from 'zod';

/** Analyst output: compact market read consumed by the strategist. */
export const MarketAnalysisSchema = z.object({
  symbol: z.string(),
  bias: z.enum(['BULLISH', 'BEARISH', 'NEUTRAL']),
  summary: z.string().min(10),
  keyLevels: z.object({
    support: z.number(),
    resistance: z.number(),
  }),
  catalysts: z.array(z.string()).max(5),
  risks: z.array(z.string()).max(5),
});
export type MarketAnalysis = z.infer<typeof MarketAnalysisSchema>;

/** Strategist output: choose among validated candidates or stand down. */
export const StrategyOutcomeSchema = z.object({
  action: z.enum(['EXECUTE', 'WAIT', 'EXIT']),
  candidateId: z.string().optional(),
  symbol: z.string().optional(),
  direction: z.enum(['LONG', 'SHORT']).optional(),
  entry: z.number().optional(),
  stopLoss: z.number().optional(),
  takeProfit: z.number().optional(),
  confidence: z.number().min(0).max(1),
  thesis: z.string().min(5),
  invalidation: z.string().min(3),
  setupType: z.string().default('LLM_DISCRETIONARY'),
});
export type StrategyOutcome = z.infer<typeof StrategyOutcomeSchema>;

/** Risk challenger output: advisory objections (never a bypass). */
export const ChallengerVerdictSchema = z.object({
  verdict: z.enum(['SUPPORT', 'OPPOSE', 'ABSTAIN']),
  objections: z.array(z.object({
    claim: z.string(),
    evidence: z.string(),
    severity: z.enum(['LOW', 'MEDIUM', 'HIGH']),
  })).max(5),
  summary: z.string(),
});
export type ChallengerVerdict = z.infer<typeof ChallengerVerdictSchema>;
