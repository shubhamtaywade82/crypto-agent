import type { IMarketDataProvider } from '../infrastructure/broker/broker.js';
import type { MarketState } from '../domain/market/types.js';
import type { RiskLimits } from '../domain/risk/risk-config.js';
import { circuitRiskMultiplier, deriveCircuitState } from '../domain/risk/risk-config.js';
import type { TradeProposal } from '../domain/orders/trade-proposal.js';
import { validateProposal } from '../domain/orders/trade-proposal.js';
import type { PortfolioState } from '../domain/portfolio/portfolio-state.js';
import type { RiskDecision } from '../domain/risk/risk-decision.js';
import type { SizingResult } from './position-sizer.js';
import { sizePosition } from './position-sizer.js';
import { evaluateRisk } from './risk-engine.js';
import { buildMarketState } from './market-state-engine.js';
import { detectSetups, type SetupCandidate } from './setup-engine.js';
import type { MtfResult } from './mtf-engine.js';
import type { StrategyOutcome } from '../agents/schemas.js';
import type { MarketAnalysis } from '../agents/schemas.js';
import type { ChallengerVerdict } from '../agents/schemas.js';
import type { EventStore } from '../infrastructure/events/event-store.js';
import type { ExecutionEngine, TrackedOrder } from './execution-engine.js';
import type { PortfolioEngine } from './portfolio-engine.js';
import { FALLBACK_SPEC } from '../domain/futures/contract-spec.js';

export interface StrategyRequest {
  readonly state: MarketState;
  readonly analysis: MarketAnalysis;
  readonly setups: readonly SetupCandidate[];
  readonly portfolio: PortfolioState;
  readonly lessons: readonly string[];
}

export interface PipelineDeps {
  readonly provider: IMarketDataProvider;
  readonly limits: RiskLimits;
  readonly portfolio: PortfolioEngine;
  readonly execution: ExecutionEngine;
  readonly store: EventStore;
  readonly challengesEnabled: boolean;
  readonly analyze: (state: MarketState) => Promise<MarketAnalysis>;
  readonly strategize: (request: StrategyRequest) => Promise<StrategyOutcome>;
  readonly challenge?: (
    proposal: TradeProposal,
    state: MarketState
  ) => Promise<ChallengerVerdict>;
  readonly execute?: (
    proposal: TradeProposal,
    sizing: SizingResult,
    risk: RiskDecision
  ) => Promise<TrackedOrder>;
  readonly getLessons?: () => readonly string[];
}

export type PipelineStatus =
  | 'NO_SETUPS' | 'WAIT' | 'EXIT_SIGNALLED'
  | 'INVALID_PROPOSAL' | 'REJECTED' | 'APPROVED' | 'EXECUTED' | 'ERROR';

export interface PipelineTrace {
  readonly symbol: string;
  readonly ranAt: number;
  readonly status: PipelineStatus;
  readonly regime: string;
  readonly state?: MarketState;
  readonly analysis?: MarketAnalysis;
  readonly setups: readonly SetupCandidate[];
  readonly outcome?: StrategyOutcome;
  readonly proposal?: TradeProposal;
  readonly sizing?: SizingResult;
  readonly risk?: RiskDecision;
  readonly challenge?: ChallengerVerdict;
  readonly order?: { readonly intentId: string; readonly status: string; readonly orderId?: string };
  readonly error?: string;
}

const stateAge = (state: MarketState): number => Date.now() - state.capturedAt;

const proposalFromCandidate = (
  outcome: StrategyOutcome,
  setups: readonly SetupCandidate[],
  fallbackSymbol: string
): TradeProposal => {
  const chosen = setups.find((s) => s.id === outcome.candidateId) ?? setups[0];
  const symbol = outcome.symbol ?? chosen?.symbol ?? fallbackSymbol;
  const useCandidate = chosen && (!outcome.entry || !outcome.stopLoss || !outcome.takeProfit);
  return {
    symbol,
    direction: outcome.direction ?? chosen?.direction ?? 'LONG',
    entry: useCandidate ? chosen.entry : outcome.entry ?? 0,
    stopLoss: useCandidate ? chosen.stopLoss : outcome.stopLoss ?? 0,
    takeProfit: useCandidate ? chosen.takeProfit : outcome.takeProfit ?? 0,
    orderType: 'MARKET',
    leverage: chosen?.leverage ?? 1,
    setupType: chosen?.type ?? outcome.setupType,
    confidence: outcome.confidence,
    thesis: outcome.thesis,
    invalidation: outcome.invalidation,
    source: 'LLM_STRATEGIST',
  };
};

export const runTradingPipeline = async (
  deps: PipelineDeps,
  symbol: string
): Promise<PipelineTrace> => {
  try {
    const mtf: MtfResult = await buildMarketState(deps.provider, symbol);
    const state = mtf.state;
    const setups = detectSetups(mtf, deps.limits);
    const base: PipelineTrace = {
      symbol, ranAt: Date.now(), status: 'NO_SETUPS', regime: state.regime, state, setups,
    };
    deps.store.append({
      type: 'pipeline.snapshot', symbol,
      payload: { regime: state.regime, setups: setups.length, btc: state.btcRegime },
    });
    if (setups.length === 0) return base;

    const analysis = await deps.analyze(state);
    const outcome = await deps.strategize({
      state, analysis, setups,
      portfolio: deps.portfolio.peek(), lessons: deps.getLessons?.() ?? [],
    });
    const withOutcome: PipelineTrace & { outcome: StrategyOutcome } = { ...base, analysis, outcome };

    if (outcome.action === 'WAIT') return { ...withOutcome, status: 'WAIT' };
    if (outcome.action === 'EXIT') return { ...withOutcome, status: 'EXIT_SIGNALLED' };
    return await stageExecution(deps, { trace: withOutcome, state, outcome, setups });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    deps.store.append({ type: 'pipeline.error', symbol, payload: { message } });
    return {
      symbol, ranAt: Date.now(), status: 'ERROR', regime: 'UNKNOWN', setups: [], error: message,
    };
  }
};

interface StageArgs {
  readonly trace: PipelineTrace & { outcome: StrategyOutcome };
  readonly state: MarketState;
  readonly outcome: StrategyOutcome;
  readonly setups: readonly SetupCandidate[];
}

/** Validate + size + risk-check a proposal against a live market state. */
export const assessProposal = (
  deps: PipelineDeps,
  proposal: TradeProposal,
  state: MarketState
): { validation: ReturnType<typeof validateProposal>; sizing: SizingResult; risk: RiskDecision } => {
  const validation = validateProposal(
    proposal, deps.limits.minRiskRewardRatio, deps.limits.maxLeverage
  );
  const portfolio = deps.portfolio.peek();
  const circuit = deriveCircuitState(
    portfolio.dailyLossPercent, portfolio.drawdownPercent, portfolio.lossStreak, deps.limits
  );
  const sizing = sizePosition({
    equity: portfolio.equity,
    availableMargin: portfolio.availableMargin,
    direction: proposal.direction,
    entry: proposal.entry,
    stop: proposal.stopLoss,
    requestedLeverage: proposal.leverage,
    fundingRate: state.futures.fundingRate,
    spec: FALLBACK_SPEC(proposal.symbol.replace(/USDT$/, '')),
    limits: deps.limits,
    circuitMultiplier: circuitRiskMultiplier(circuit),
  });
  const risk = evaluateRisk({
    proposal, validation, sizing, portfolio, limits: deps.limits,
    marketStateAgeMs: stateAge(state),
  });
  return { validation, sizing, risk };
};

const stageExecution = async (
  deps: PipelineDeps,
  args: StageArgs
): Promise<PipelineTrace> => {
  const { trace, state, outcome, setups } = args;
  const proposal = proposalFromCandidate(outcome, setups, trace.symbol);
  const { sizing, risk } = assessProposal(deps, proposal, state);
  const staged: PipelineTrace = { ...trace, proposal, sizing, risk };

  if (!risk.approved) {
    deps.store.append({
      type: 'risk.rejected', symbol: proposal.symbol, decisionId: risk.decisionId,
      payload: { reasons: risk.reasons },
    });
    return { ...staged, status: 'REJECTED' };
  }
  const challenge = deps.challengesEnabled && deps.challenge
    ? await deps.challenge(proposal, state)
    : undefined;
  if (challenge) {
    deps.store.append({
      type: 'risk.challenge', symbol: proposal.symbol, decisionId: risk.decisionId,
      payload: { verdict: challenge.verdict, objections: challenge.objections },
    });
  }
  if (deps.execute) {
    const order = await deps.execute(proposal, sizing, risk);
    return {
      ...staged, challenge, status: 'EXECUTED',
      order: { intentId: risk.decisionId, status: order.status, orderId: order.orderId },
    };
  }
  return { ...staged, challenge, status: 'APPROVED' };
};
