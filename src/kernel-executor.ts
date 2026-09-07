import type { IExecutionBroker } from './infrastructure/broker/broker.js';
import { PaperExecutionBroker } from './infrastructure/paper/paper-broker-adapter.js';
import type { SymbolRouter } from './infrastructure/coindcx/symbol-router.js';
import type { ExecutionEngine, TrackedOrder } from './engines/execution-engine.js';
import type { TradeProposal } from './domain/orders/trade-proposal.js';
import type { SizingResult } from './engines/position-sizer.js';
import type { RiskDecision } from './domain/risk/risk-decision.js';
import { createLogger } from './infrastructure/observability/logger.js';

/**
 * Entry-execution wiring shared by every venue: resolve the venue pair,
 * seed the paper simulator's mark, register the risk-approved intent and
 * submit under the execution-quality contract.
 */

/** Slippage tolerance applied to entry execution (basis points). */
const maxSlippageBps = (): number => Number(process.env.MAX_SLIPPAGE_BPS ?? 25);

const resolvePair = async (
  broker: IExecutionBroker,
  router: SymbolRouter | undefined,
  symbol: string
): Promise<string> => {
  if (broker.id === 'coindcx' && router) return (await router.resolve(symbol)).pair;
  return `B-${symbol.replace(/USDT$/, '')}_USDT`;
};

interface SubmitArgs {
  readonly pair: string;
  readonly proposal: TradeProposal;
  readonly sizing: SizingResult;
  readonly risk: RiskDecision;
}

const registerAndSubmit = (
  execution: ExecutionEngine,
  args: SubmitArgs
): Promise<TrackedOrder> => {
  const { pair, proposal, sizing, risk } = args;
  const side = proposal.direction === 'LONG' ? 'buy' : 'sell';
  execution.registerApproved({
    intentId: risk.decisionId, pair, symbol: proposal.symbol,
    side, quantity: sizing.quantity,
  });
  return execution.submit(risk.decisionId, {
    pair, side, orderType: 'market_order',
    quantity: sizing.quantity, leverage: sizing.leverage,
    marginType: 'isolated',
    stopLoss: proposal.stopLoss, takeProfit: proposal.takeProfit,
    // Execution-quality contract: never allow an unbounded fill.
    expectedPrice: proposal.entry,
    maxSlippageBps: maxSlippageBps(),
    // Audit lineage.
    strategyId: proposal.setupType,
    decisionId: risk.decisionId,
    intentType: 'ENTRY',
  });
};

export type KernelExecutor = (
  proposal: TradeProposal,
  sizing: SizingResult,
  risk: RiskDecision,
  reservationId?: string
) => Promise<TrackedOrder>;

export const buildExecutor = (
  broker: IExecutionBroker,
  router: SymbolRouter | undefined,
  execution: ExecutionEngine
): KernelExecutor => {
  const log = createLogger('executor');
  return async (proposal, sizing, risk, _reservationId): Promise<TrackedOrder> => {
    const pair = await resolvePair(broker, router, proposal.symbol);
    if (broker instanceof PaperExecutionBroker) broker.setMarkPrice(pair, proposal.entry);
    log.info('submitting approved entry', {
      symbol: proposal.symbol, pair, decisionId: risk.decisionId,
    });
    return registerAndSubmit(execution, { pair, proposal, sizing, risk });
  };
};
