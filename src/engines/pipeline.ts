import type { IMarketDataProvider } from '../infrastructure/broker/broker.js';
import type { MarketState } from '../domain/market/types.js';
import { type RiskLimits, circuitRiskMultiplier, deriveCircuitState } from '../domain/risk/risk-config.js';
import { type TradeProposal, type ValidationResult, validateProposal } from '../domain/orders/trade-proposal.js';
import type { PortfolioState } from '../domain/portfolio/portfolio-state.js';
import { type RiskDecision, rejected } from '../domain/risk/risk-decision.js';
import { type SizingResult, sizePosition, failedSizing } from './position-sizer.js';
import { evaluateRisk } from './risk-engine.js';
import { buildMarketState, buildMtfFromStore } from './market-state-engine.js';
import { detectSetups, type SetupCandidate } from './setup-engine.js';
import { stageExecution } from './pipeline-stage.js';
export { stageExecution };
import type { MtfResult } from './mtf-engine.js';
import type { StrategyOutcome, MarketAnalysis, ChallengerVerdict } from '../agents/schemas.js';
import type { EventStore } from '../infrastructure/events/event-store.js';
import type { ExecutionEngine, TrackedOrder } from './execution-engine.js';
import type { PortfolioEngine } from './portfolio-engine.js';
import type { RiskReservationManager } from './risk-reservations.js';
import type { TradeLedger, TradeFeatureSnapshot } from '../learning/trade-ledger.js';
import type { MarketStateStore } from './market-state-store.js';
import type { ContractSpec } from '../domain/futures/contract-spec.js';
import { makeId } from '../domain/primitives.js';

export interface StrategyRequest {
  readonly state: MarketState;
  readonly analysis: MarketAnalysis;
  readonly setups: readonly SetupCandidate[];
  readonly portfolio: PortfolioState;
  readonly lessons: readonly string[];
  readonly evidence?: string;
}

export interface PipelineDeps {
  readonly provider: IMarketDataProvider;
  readonly limits: RiskLimits;
  readonly portfolio: PortfolioEngine;
  readonly execution: ExecutionEngine;
  readonly store: EventStore;
  readonly challengesEnabled: boolean;
  /** Resolve venue contract spec; failures reject trade (degraded trading). */
  readonly specFor: (symbol: string) => Promise<ContractSpec>;
  readonly reservations?: RiskReservationManager;
  /** Global trading gate (kill switch). When blocked, pipeline returns HALTED. */
  readonly isTradingAllowed?: () => { readonly allowed: boolean; readonly reason?: string };
  readonly ledger?: TradeLedger;
  /** Event-driven market cache (Binance WS) for zero-REST MTF ladders. */
  readonly marketStore?: MarketStateStore;
  readonly marketMaxStaleMs?: number;
  /** Cross-venue execution gate: basis/spread/health beyond tolerance rejects trade. */
  readonly crossVenueGate?: (symbol: string) => Promise<{
    readonly tradable: boolean; readonly reasons: readonly string[];
  }>;
  /** Strategy-cell gate (ACTIVE strategy + approved cell = tradable). */
  readonly strategyGate?: (
    strategyId: string, setupType: string, regime: string
  ) => { readonly allowed: boolean; readonly reason?: string };
  /** Market-research evidence gate: blocks confounded / insufficient_sample cells. */
  readonly evidenceGate?: (symbol: string, setupType: string) => Promise<{ readonly allowed: boolean; readonly reason?: string }>;
  readonly analyze: (state: MarketState, evidence?: string) => Promise<MarketAnalysis>;
  readonly strategize: (request: StrategyRequest) => Promise<StrategyOutcome>;
  readonly challenge?: (proposal: TradeProposal, state: MarketState) => Promise<ChallengerVerdict>;
  readonly execute?: (
    proposal: TradeProposal, sizing: SizingResult, risk: RiskDecision, reservationId?: string
  ) => Promise<TrackedOrder>;
  readonly getLessons?: () => readonly string[];
  readonly getEvidence?: (symbol: string) => Promise<string | undefined>;
  readonly registerPendingSnapshot?: (snapshot: TradeFeatureSnapshot) => void;
  /** Roll back a pending learning snapshot when submission fails before fill. */
  readonly clearPendingSnapshot?: (decisionId: string) => void;
  /** Safety net when fill hook did not consume the snapshot (e.g. sync fill race). */
  readonly commitPendingSnapshot?: (decisionId: string) => void;
}

export type PipelineStatus =
  | 'NO_SETUPS' | 'WAIT' | 'EXIT_SIGNALLED'
  | 'INVALID_PROPOSAL' | 'REJECTED' | 'APPROVED' | 'EXECUTED' | 'ERROR'
  | 'HALTED';

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

const haltedTrace = (deps: PipelineDeps, symbol: string): PipelineTrace => {
  const gate = deps.isTradingAllowed?.();
  const reason = gate?.allowed === false ? (gate.reason ?? 'trading halted') : 'trading halted';
  deps.store.append({ type: 'pipeline.halted', symbol, payload: { reason } });
  return { symbol, ranAt: Date.now(), status: 'HALTED', regime: 'UNKNOWN', setups: [], error: reason };
};

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

interface MarketContext {
  readonly mtf: MtfResult;
  readonly setups: ReturnType<typeof detectSetups>;
}

const emitSnapshot = (
  deps: PipelineDeps, ctx: MarketContext, symbol: string, provenance: 'stream' | 'rest'
): void => {
  deps.store.append({
    type: 'pipeline.snapshot', symbol,
    payload: {
      regime: ctx.mtf.state.regime, setups: ctx.setups.length,
      btc: ctx.mtf.state.btcRegime, provenance,
    },
  });
};

/** Event-driven path: fresh WS store -> MTF + setups with zero REST. */
const streamContext = (deps: PipelineDeps, symbol: string): MarketContext | undefined => {
  const maxStaleMs = deps.marketMaxStaleMs ?? 45_000;
  if (!deps.marketStore?.isFresh(symbol, maxStaleMs)) return undefined;
  const mtf = buildMtfFromStore(deps.marketStore, symbol);
  if (!mtf) return undefined;
  const setups = detectSetups(mtf, deps.limits);
  deps.ledger?.recordMark(symbol, mtf.state.price.mark);
  const ctx: MarketContext = { mtf, setups };
  emitSnapshot(deps, ctx, symbol, 'stream');
  return ctx;
};

/** REST recovery path (cold start, stream stale/down, partial ladders). */
const restContext = async (deps: PipelineDeps, symbol: string): Promise<MarketContext> => {
  const mtf: MtfResult = await buildMarketState(deps.provider, symbol);
  // Feed the learning ledger's MAE/MFE trackers with the fresh mark.
  deps.ledger?.recordMark(symbol, mtf.state.price.mark);
  const ctx: MarketContext = { mtf, setups: detectSetups(mtf, deps.limits) };
  emitSnapshot(deps, ctx, symbol, 'rest');
  return ctx;
};

/** Market data + setup detection: the shared pre-strategy stage. */
const gatherMarketContext = async (
  deps: PipelineDeps,
  symbol: string
): Promise<MarketContext> => streamContext(deps, symbol) ?? (await restContext(deps, symbol));

export const runTradingPipeline = async (
  deps: PipelineDeps,
  symbol: string
): Promise<PipelineTrace> => {
  try {
    // Kill switch first: no market data, no LLM calls, no risk work.
    if (deps.isTradingAllowed && !deps.isTradingAllowed().allowed) {
      return haltedTrace(deps, symbol);
    }
    const portfolio = await refreshPortfolio(deps, symbol);
    const { mtf, setups } = await gatherMarketContext(deps, symbol);
    const state = mtf.state;
    const base: PipelineTrace = {
      symbol, ranAt: Date.now(), status: 'NO_SETUPS', regime: state.regime, state, setups,
    };
    if (setups.length === 0) return base;

    const evidence = deps.getEvidence ? await deps.getEvidence(symbol) : undefined;
    const analysis = await deps.analyze(state, evidence);
    const outcome = await deps.strategize({
      state, analysis, setups,
      portfolio, lessons: deps.getLessons?.() ?? [], evidence,
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
