import type { ResearchOutcome } from '@nemesis-oss/market-research-agent';
import {
  buildFvgEvidenceSignal,
  findResearchResultByEventType,
  isWalkForwardStableForComponent,
  type AgentRunStatus,
  type BinanceKlineMarket,
  type FvgEvidenceTradingSignal,
} from '@nemesis-oss/market-research';
import type { ResearchResult } from '@nemesis-oss/market-research';
import type { EvidenceSnapshot } from './mi-evidence.js';

export type { FvgEvidenceTradingSignal };

export interface MiAgentFvgSignalInput {
  readonly evidence: EvidenceSnapshot;
  readonly klineMarket?: BinanceKlineMarket;
  readonly agentOutcome?: Pick<ResearchOutcome, 'status' | 'report'> | null;
  readonly walkForwardStable?: boolean | null;
  readonly requireWalkForwardStable?: boolean;
}

/**
 * Deterministic read-only FVG gate for crypto-agent kernel / council.
 * Uses {@link ResearchResult} numbers only; agent prose is excerpt-only.
 */
export const buildMiFvgTradingSignal = (
  input: MiAgentFvgSignalInput
): FvgEvidenceTradingSignal | undefined => {
  const fvg = findResearchResultByEventType(input.evidence.results, 'fvg');
  if (!fvg) return undefined;

  const wfStable =
    input.walkForwardStable ??
    null;

  return buildFvgEvidenceSignal(fvg, {
    klineMarket: input.klineMarket ?? 'usdm_futures',
    walkForwardStable: wfStable,
    requireWalkForwardStable: input.requireWalkForwardStable ?? false,
    agentRunStatus: (input.agentOutcome?.status ?? null) as AgentRunStatus | null,
    agentReport: input.agentOutcome?.report ?? null,
  });
};

export const fvgResearchFromSnapshot = (
  snap: EvidenceSnapshot | undefined
): ResearchResult | undefined =>
  snap ? findResearchResultByEventType(snap.results, 'fvg') : undefined;

export { isWalkForwardStableForComponent };
