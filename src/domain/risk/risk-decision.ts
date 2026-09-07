import type { CircuitState, RiskLimits } from './risk-config.js';

export type RejectionReason =
  | 'CIRCUIT_HALTED'
  | 'RISK_PER_TRADE_EXCEEDED'
  | 'DAILY_LOSS_EXCEEDED'
  | 'MAX_LEVERAGE_EXCEEDED'
  | 'MIN_RR_NOT_MET'
  | 'MAX_POSITIONS_EXCEEDED'
  | 'MAX_NOTIONAL_EXCEEDED'
  | 'SYMBOL_EXPOSURE_EXCEEDED'
  | 'PORTFOLIO_EXPOSURE_EXCEEDED'
  | 'CORRELATED_EXPOSURE_EXCEEDED'
  | 'LOSS_STREAK_EXCEEDED'
  | 'INVALID_PROPOSAL'
  | 'STALE_MARKET_STATE'
  | 'INSTRUMENT_SPEC_UNAVAILABLE';

export interface RiskCheck {
  readonly name: string;
  readonly passed: boolean;
  readonly detail: string;
}

/** The final authority output — the LLM can never override this. */
export interface RiskDecision {
  readonly approved: boolean;
  readonly reasons: string[];
  readonly rejections: RejectionReason[];
  readonly riskAmount: number;
  readonly notional: number;
  readonly leverage: number;
  readonly marginRequired: number;
  readonly projectedDrawdown: number;
  readonly circuitState: CircuitState;
  readonly checks: readonly RiskCheck[];
  readonly decisionId: string;
}

export const rejected = (
  checks: readonly RiskCheck[],
  rejections: RejectionReason[],
  circuitState: CircuitState,
  decisionId: string
): RiskDecision => ({
  approved: false,
  reasons: rejections.map((r) => r.replaceAll('_', ' ').toLowerCase()),
  rejections,
  riskAmount: 0,
  notional: 0,
  leverage: 0,
  marginRequired: 0,
  projectedDrawdown: 0,
  circuitState,
  checks,
  decisionId,
});

export const limitsSummary = (l: RiskLimits): Record<string, number> => ({
  maxRiskPerTradePercent: l.maxRiskPerTradePercent,
  maxDailyLossPercent: l.maxDailyLossPercent,
  maxLeverage: l.maxLeverage,
  minRiskRewardRatio: l.minRiskRewardRatio,
  maxConcurrentPositions: l.maxConcurrentPositions,
  maxNotionalPerTrade: l.maxNotionalPerTrade,
});
