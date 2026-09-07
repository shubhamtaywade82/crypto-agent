import type { IMarketDataProvider } from '../infrastructure/broker/broker.js';
import type { MarketState } from '../domain/market/types.js';
import type { RiskLimits } from '../domain/risk/risk-config.js';
import { circuitRiskMultiplier, deriveCircuitState } from '../domain/risk/risk-config.js';
import type { TradeProposal, ValidationResult } from '../domain/orders/trade-proposal.js';
import { validateProposal } from '../domain/orders/trade-proposal.js';
import type { PortfolioState } from '../domain/portfolio/portfolio-state.js';
import type { RiskDecision } from '../domain/risk/risk-decision.js';
import { rejected } from '../domain/risk/risk-decision.js';
import type { SizingResult } from './position-sizer.js';
import { sizePosition, failedSizing } from './position-sizer.js';
import { evaluateRisk } from './risk-engine.js';
import { buildMarketState } from './market-state-engine.js';
import { detectSetups, type SetupCandidate } from './setup-engine.js';
import { stageExecution } from './pipeline-stage.js';
export { stageExecution };
import type { MtfResult } from './mtf-engine.js';
import type { StrategyOutcome } from '../agents/schemas.js';
import type { MarketAnalysis } from '../agents/schemas.js';
import type { ChallengerVerdict } from '../agents/schemas.js';
import type { EventStore } from '../infrastructure/events/event-store.js';
import type { ExecutionEngine, TrackedOrder } from './execution-engine.js';
import type { PortfolioEngine } from './portfolio-engine.js';
import type { RiskReservationManager } from './risk-reservations.js';
import type { ContractSpec } from '../domain/futures/contract-spec.js';
import { makeId } from '../domain/primitives.js';

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
  /**
   * Resolve the REAL venue contract spec for a market-data symbol.
   * Implementations back this with the ContractRegistry; failures must
   * reject the trade (degraded trading) instead of falling back to
   * synthetic constraints.
   */
  readonly specFor: (symbol: string) => Promise<ContractSpec>;
  /** Global risk reservations (concurrency-safe portfolio accounting). */
  readonly reservations?: RiskReservationManager;
  readonly analyze: (state: MarketState) => Promise<MarketAnalysis>;
  readonly strategize: (request: StrategyRequest) => Promise<StrategyOutcome>;
  readonly challenge?: (
    proposal: TradeProposal,
    state: MarketState
  ) => Promise<ChallengerVerdict>;
  readonly execute?: (
    proposal: TradeProposal,
    sizing: SizingResult,
    risk: RiskDecision,
    reservationId?: string
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
  readonly validation?: ValidationResult;
  readonly sizing?: SizingResult;
  readonly risk?: RiskDecision;
  readonly challenge?: ChallengerVerdict;
  readonly order?: { readonly intentId: string; readonly status: string; readonly orderId?: string };
  readonly error?: string;
}

const stateAge = (state: MarketState): number => Date.now() - state.capturedAt;

/** Live portfolio truth for this run; degrade to peek() if the venue fails. */
const refreshPortfolio = async (
  deps: PipelineDeps,
  symbol: string
): Promise<PortfolioState> => {
  try {
    return await deps.portfolio.refresh();
  } catch (err) {
    deps.store.append({
      type: 'portfolio.refresh_failed',
      symbol,
      payload: { message: err instanceof Error ? err.message : String(err) },
    });
    return deps.portfolio.peek();
  }
};

export const runTradingPipeline = async (
  deps: PipelineDeps,
  symbol: string
): Promise<PipelineTrace> => {
  try {
    const portfolio = await refreshPortfolio(deps, symbol);
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
      portfolio, lessons: deps.getLessons?.() ?? [],
    });
    const withOutcome: PipelineTrace & { outcome: StrategyOutcome } = { ...base, analysis, outcome };

    if (outcome.action === 'WAIT') return { ...withOutcome, status: 'WAIT' };
    if (outcome.action === 'EXIT') return { ...withOutcome, status: 'EXIT_SIGNALLED' };
    return await stageExecution(deps, { trace: withOutcome, state, outcome, setups, portfolio });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    deps.store.append({ type: 'pipeline.error', symbol, payload: { message } });
    return {
      symbol, ranAt: Date.now(), status: 'ERROR', regime: 'UNKNOWN', setups: [], error: message,
    };
  }
};

/** Degraded-trading rejection when the instrument spec cannot be resolved. */
const specUnavailable = (
  circuitState: ReturnType<typeof deriveCircuitState>,
  err: unknown
): RiskDecision => {
  const detail = err instanceof Error ? err.message : String(err);
  return rejected(
    [{ name: 'instrument_spec', passed: false, detail }],
    ['INSTRUMENT_SPEC_UNAVAILABLE'],
    circuitState, makeId('decision')
  );
};

/**
 * Validate + size + risk-check a proposal against a live market state.
 * Uses the REAL venue contract spec (via deps.specFor); a spec lookup
 * failure rejects with INSTRUMENT_SPEC_UNAVAILABLE rather than sizing
 * against invented constraints.
 */
interface SizeContext {
  readonly deps: PipelineDeps;
  readonly proposal: TradeProposal;
  readonly state: MarketState;
  readonly portfolio: PortfolioState;
  readonly circuit: ReturnType<typeof deriveCircuitState>;
  readonly spec: ContractSpec;
}

const sizeAgainstSpec = (ctx: SizeContext): SizingResult =>
  sizePosition({
    equity: ctx.portfolio.equity,
    availableMargin: ctx.portfolio.availableMargin,
    direction: ctx.proposal.direction,
    entry: ctx.proposal.entry,
    stop: ctx.proposal.stopLoss,
    requestedLeverage: ctx.proposal.leverage,
    fundingRate: ctx.state.futures.fundingRate,
    spec: ctx.spec,
    limits: ctx.deps.limits,
    circuitMultiplier: circuitRiskMultiplier(ctx.circuit),
  });

export const assessProposal = async (
  deps: PipelineDeps,
  proposal: TradeProposal,
  state: MarketState,
  portfolioOverride?: PortfolioState
): Promise<{ validation: ValidationResult; sizing: SizingResult; risk: RiskDecision }> => {
  const validation = validateProposal(
    proposal, deps.limits.minRiskRewardRatio, deps.limits.maxLeverage
  );
  const portfolio = portfolioOverride ?? deps.portfolio.peek();
  const circuit = deriveCircuitState(
    portfolio.dailyLossPercent, portfolio.drawdownPercent, portfolio.lossStreak, deps.limits
  );

  let spec: ContractSpec;
  try {
    spec = await deps.specFor(proposal.symbol);
  } catch (err) {
    return {
      validation,
      sizing: failedSizing('instrument spec unavailable'),
      risk: specUnavailable(circuit, err),
    };
  }

  const sizing = sizeAgainstSpec({ deps, proposal, state, portfolio, circuit, spec });
  const risk = evaluateRisk({
    proposal, validation, sizing, portfolio, limits: deps.limits,
    marketStateAgeMs: stateAge(state),
  });
  return { validation, sizing, risk };
};
