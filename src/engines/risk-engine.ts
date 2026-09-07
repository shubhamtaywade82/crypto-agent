import type { TradeProposal, ValidationResult } from '../domain/orders/trade-proposal.js';
import type { PortfolioState } from '../domain/portfolio/portfolio-state.js';
import { clusterExposureOf, clusterOf, symbolExposureOf } from '../domain/portfolio/portfolio-state.js';
import type { RiskCheck, RiskDecision } from '../domain/risk/risk-decision.js';
import { rejected } from '../domain/risk/risk-decision.js';
import type { CircuitState, RiskLimits } from '../domain/risk/risk-config.js';
import { circuitRiskMultiplier, deriveCircuitState } from '../domain/risk/risk-config.js';
import type { SizingResult } from './position-sizer.js';
import { makeId } from '../domain/primitives.js';

export interface RiskEvaluationInput {
  readonly proposal: TradeProposal;
  readonly validation: ValidationResult;
  readonly sizing: SizingResult;
  readonly portfolio: PortfolioState;
  readonly limits: RiskLimits;
  /** Age of the MarketState snapshot in ms (staleness gate). */
  readonly marketStateAgeMs: number;
  readonly maxMarketStateAgeMs?: number;
}

const MAX_STATE_AGE_DEFAULT = 30_000;

const check = (name: string, passed: boolean, detail: string): RiskCheck =>
  ({ name, passed, detail });

const portfolioCheck = (input: RiskEvaluationInput, portfolio: PortfolioState): RiskCheck => {
  const { sizing, proposal, limits } = input;
  const symbolNow = symbolExposureOf(portfolio, proposal.symbol) + sizing.notional;
  const cluster = clusterOf(proposal.symbol);
  const clusterNow = clusterExposureOf(portfolio, cluster) + sizing.notional;
  const grossNow = portfolio.grossExposure + sizing.notional;
  const equity = Math.max(1, portfolio.equity);
  const pct = (v: number): number => Number(((v / equity) * 100).toFixed(3));

  const passed =
    pct(symbolNow) <= limits.maxSymbolExposurePercent &&
    pct(grossNow) <= limits.maxPortfolioGrossExposurePercent &&
    pct(clusterNow) <= limits.maxCorrelatedExposurePercent &&
    sizing.notional <= limits.maxNotionalPerTrade;
  return check('portfolio_limits', passed,
    `symbol ${pct(symbolNow)}% (max ${limits.maxSymbolExposurePercent}%), ` +
    `gross ${pct(grossNow)}% (max ${limits.maxPortfolioGrossExposurePercent}%), ` +
    `cluster ${cluster} ${pct(clusterNow)}% (max ${limits.maxCorrelatedExposurePercent}%), ` +
    `notional ${sizing.notional.toFixed(2)} (max ${limits.maxNotionalPerTrade})`);
};

const buildChecks = (
  input: RiskEvaluationInput,
  portfolio: PortfolioState,
  circuitState: CircuitState
): readonly RiskCheck[] => {
  const { validation, sizing, limits } = input;
  const maxAge = input.maxMarketStateAgeMs ?? MAX_STATE_AGE_DEFAULT;
  const riskBudget = portfolio.equity * limits.maxRiskPerTradePercent / 100 *
    circuitRiskMultiplier(circuitState);
  return [
    check('trade_structure', validation.valid, validation.valid
      ? `RR ${validation.rr.toFixed(2)}`
      : validation.reasons.join('; ')),
    check('market_state_freshness', input.marketStateAgeMs <= maxAge,
      `state age ${input.marketStateAgeMs}ms (max ${maxAge}ms)`),
    check('sizing', sizing.ok, sizing.ok
      ? `qty ${sizing.quantity} risk ${sizing.riskAmount.toFixed(2)}`
      : (sizing.rejection ?? 'sizing failed')),
    check('risk_per_trade', sizing.ok && sizing.riskAmount <= riskBudget * 1.02,
      `risk ${sizing.ok ? sizing.riskAmount.toFixed(2) : 'n/a'} vs budget ${riskBudget.toFixed(2)}`),
    check('leverage', sizing.ok && sizing.leverage <= limits.maxLeverage,
      `leverage ${sizing.leverage} (max ${limits.maxLeverage})`),
    check('position_count', portfolio.openPositions + 1 <= limits.maxConcurrentPositions,
      `${portfolio.openPositions + 1} of max ${limits.maxConcurrentPositions}`),
    check('daily_loss', portfolio.dailyLossPercent < limits.maxDailyLossPercent,
      `daily loss ${portfolio.dailyLossPercent.toFixed(2)}% of ${limits.maxDailyLossPercent}%`),
    check('loss_streak', portfolio.lossStreak < limits.maxLossStreak,
      `streak ${portfolio.lossStreak} of max ${limits.maxLossStreak}`),
    portfolioCheck(input, portfolio),
  ];
};

/**
 * The final authority. The LLM proposes; this engine disposes.
 * All checks are deterministic; any failure means REJECTED.
 */
export const evaluateRisk = (input: RiskEvaluationInput): RiskDecision => {
  const { portfolio, limits } = input;
  const decisionId = makeId('decision');
  const circuitState: CircuitState = deriveCircuitState(
    portfolio.dailyLossPercent, portfolio.drawdownPercent, portfolio.lossStreak, limits
  );

  if (circuitState === 'HALTED' || circuitState === 'EMERGENCY') {
    return rejected(
      [check('circuit_breaker', false, `circuit state ${circuitState}`)],
      ['CIRCUIT_HALTED'], circuitState, decisionId
    );
  }

  const checks = buildChecks(input, portfolio, circuitState);
  const failed = checks.find((c) => !c.passed);
  if (failed) {
    return rejected(
      checks,
      [failed.name === 'trade_structure' ? 'MIN_RR_NOT_MET' : 'INVALID_PROPOSAL'],
      circuitState, decisionId
    );
  }

  return {
    approved: true,
    reasons: [`all ${checks.length} checks passed`, `circuit ${circuitState}`],
    rejections: [],
    riskAmount: input.sizing.riskAmount,
    notional: input.sizing.notional,
    leverage: input.sizing.leverage,
    marginRequired: input.sizing.marginRequired,
    projectedDrawdown: (input.sizing.riskAmount / Math.max(1, portfolio.equity)) * 100,
    circuitState,
    checks,
    decisionId,
  };
};
