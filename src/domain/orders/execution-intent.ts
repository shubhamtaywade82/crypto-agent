import type { TradeProposal } from './trade-proposal.js';
import type { SizingResult } from '../../engines/position-sizer.js';
import type { RiskDecision } from '../risk/risk-decision.js';

/**
 * Immutable trade execution intent.
 * Once constructed and risk-approved, its parameters cannot be altered.
 */
export interface ExecutionIntent {
  readonly intentId: string;
  readonly symbol: string;
  readonly pair: string;
  readonly side: 'buy' | 'sell';
  readonly proposal: TradeProposal;
  readonly sizing: SizingResult;
  readonly risk: RiskDecision;
  readonly reservationId: string;
  readonly expectedPrice: number;
  readonly maxSlippageBps: number;
  readonly regime: string;
  readonly fundingRate: number;
  readonly createdAt: number;
}

export interface BuildExecutionIntentParams {
  readonly pair: string;
  readonly proposal: TradeProposal;
  readonly sizing: SizingResult;
  readonly risk: RiskDecision;
  readonly reservationId: string;
  readonly expectedPrice: number;
  readonly maxSlippageBps: number;
  readonly regime: string;
  readonly fundingRate: number;
  readonly createdAt?: number;
}

export const buildExecutionIntent = (params: BuildExecutionIntentParams): ExecutionIntent => {
  if (params.expectedPrice <= 0) {
    throw new Error(`Invalid expectedPrice: ${params.expectedPrice}`);
  }
  if (params.maxSlippageBps < 0) {
    throw new Error(`Invalid maxSlippageBps: ${params.maxSlippageBps}`);
  }
  return Object.freeze({
    intentId: params.risk.decisionId,
    symbol: params.proposal.symbol,
    pair: params.pair,
    side: params.proposal.direction === 'LONG' ? 'buy' : 'sell',
    proposal: params.proposal,
    sizing: params.sizing,
    risk: params.risk,
    reservationId: params.reservationId,
    expectedPrice: params.expectedPrice,
    maxSlippageBps: params.maxSlippageBps,
    regime: params.regime,
    fundingRate: params.fundingRate,
    createdAt: params.createdAt ?? Date.now(),
  });
};
