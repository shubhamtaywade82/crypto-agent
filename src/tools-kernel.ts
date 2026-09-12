import { z } from 'zod';
import { defineTool, type AnyTool } from '@nemesis-oss/ollama-sdk';
import { getKernel } from './kernel.js';
import { buildMarketState } from './engines/market-state-engine.js';
import { detectSetups } from './engines/setup-engine.js';
import type { TradeProposal } from './domain/orders/trade-proposal.js';
import { deriveCircuitState } from './domain/risk/risk-config.js';
import { DEFAULT_RISK_LIMITS } from './domain/risk/risk-config.js';
import type { GatewayProposeResult } from './engines/policy-gateway.js';

const proposalSchema = z.object({
  symbol: z.string().describe('Market symbol, e.g. SOLUSDT'),
  direction: z.enum(['LONG', 'SHORT']),
  entry: z.number().describe('Intended entry price (USDT terms)'),
  stopLoss: z.number().describe('Stop loss price'),
  takeProfit: z.number().describe('Take profit price'),
  confidence: z.number().min(0).max(1).default(0.7),
  thesis: z.string().default('agent proposal'),
  invalidation: z.string().default('structural invalidation'),
  setupType: z.string().default('LLM_DISCRETIONARY'),
});

const buildProposal = (p: z.infer<typeof proposalSchema>): TradeProposal => ({
  symbol: p.symbol.toUpperCase(),
  direction: p.direction,
  entry: p.entry,
  stopLoss: p.stopLoss,
  takeProfit: p.takeProfit,
  orderType: 'MARKET',
  leverage: 1,
  setupType: p.setupType,
  confidence: p.confidence,
  thesis: p.thesis,
  invalidation: p.invalidation,
  source: 'LLM_STRATEGIST',
});

const createStateTool = (): AnyTool =>
  defineTool({
    name: 'get_market_state',
    description:
      'Deterministic multi-timeframe market intelligence (4h/1h/15m/5m structure, ' +
      'momentum, volatility, liquidity sweeps, funding, open interest). ' +
      'Use this INSTEAD of many raw kline/ticker calls.',
    schema: z.object({ symbol: z.string() }),
    execute: async (args) => {
      const kernel = getKernel();
      const mtf = await buildMarketState(kernel.provider, args.symbol.toUpperCase());
      return mtf.state;
    },
  });

const createSetupsTool = (): AnyTool =>
  defineTool({
    name: 'get_trade_setups',
    description:
      'Runs the deterministic setup engine: returns ranked, RR-validated trade ' +
      'candidates (entry/SL/TP pre-computed). Execute via propose_trade.',
    schema: z.object({ symbol: z.string() }),
    execute: async (args) => {
      const kernel = getKernel();
      const mtf = await buildMarketState(kernel.provider, args.symbol.toUpperCase());
      return { setups: detectSetups(mtf, kernel.limits) };
    },
  });

const formatProposalResult = (res: GatewayProposeResult): Record<string, unknown> => {
  if (!res.approved) {
    return {
      approved: false,
      status: res.status,
      reasons: res.reasons ?? res.risk?.reasons ?? [res.status],
      circuitState: res.risk?.circuitState,
      rejections: res.risk?.rejections,
    };
  }
  return {
    decisionId: res.decisionId,
    approved: true,
    expiresAt: res.expiresAt,
    circuitState: res.risk.circuitState,
    rejections: res.risk.rejections,
    reasons: res.risk.reasons,
    sizing: {
      quantity: res.sizing.quantity,
      notional: res.sizing.notional,
      leverage: res.sizing.leverage,
      riskAmount: res.sizing.riskAmount,
      warnings: res.sizing.warnings,
    },
    rr: res.validation.rr,
    checks: res.risk.checks,
  };
};

const runProposeTrade = async (args: z.infer<typeof proposalSchema>): Promise<Record<string, unknown>> => {
  const kernel = getKernel();
  const symbol = args.symbol.toUpperCase();
  const mtf = await buildMarketState(kernel.provider, symbol);
  const proposal = buildProposal({ ...args, symbol });
  const pair = kernel.router && kernel.broker.id === 'coindcx'
    ? (await kernel.router.resolve(symbol)).pair
    : `B-${symbol.replace(/USDT$/, '')}_USDT`;
  const result = await kernel.gateway.propose(proposal, mtf.state, pair);
  return formatProposalResult(result);
};

const createProposeTool = (): AnyTool =>
  defineTool({
    name: 'propose_trade',
    description:
      'Submit a trade proposal to the Policy Gate. The RiskEngine is the final ' +
      'authority: it validates structure and R:R, sizes the position professionally ' +
      'and returns APPROVED or REJECTED. Approval does NOT execute — call ' +
      'execute_approved_intent with the returned decisionId.',
    schema: proposalSchema,
    execute: async (args) => runProposeTrade(args),
  });

const runExecuteApprovedIntent = async (decisionId: string): Promise<Record<string, unknown>> => {
  const kernel = getKernel();
  const result = await kernel.gateway.executeApproved(decisionId);
  if (!result.ok) {
    return {
      executed: false,
      status: result.status,
      reason: result.reasons?.join(', ') ?? result.status,
    };
  }
  return {
    executed: true,
    intentId: result.intent.intentId,
    status: result.status,
    orderId: result.order.orderId,
  };
};

const createExecuteTool = (): AnyTool =>
  defineTool({
    name: 'execute_approved_intent',
    description:
      'Execute a RISK_APPROVED intent by its decisionId. Orders are idempotent ' +
      '(client_order_id = decisionId). Fails if the intent was never approved, expired, or halted.',
    schema: z.object({
      decisionId: z.string().describe('The decisionId returned by propose_trade'),
    }),
    execute: async (args) => runExecuteApprovedIntent(args.decisionId),
  });

const createPortfolioTool = (): AnyTool =>
  defineTool({
    name: 'get_portfolio_state',
    description: 'Equity, margin usage, exposures per symbol/cluster, daily loss, loss streak.',
    schema: z.object({}),
    execute: async () => {
      const kernel = getKernel();
      return kernel.portfolio.refresh();
    },
  });

const createRiskStatusTool = (): AnyTool =>
  defineTool({
    name: 'get_risk_status',
    description: 'Circuit breaker state and the active prop-firm risk limits.',
    schema: z.object({}),
    execute: async () => {
      const kernel = getKernel();
      const pf = await kernel.portfolio.refresh();
      const circuitState = deriveCircuitState(
        pf.dailyLossPercent, pf.drawdownPercent, pf.lossStreak, kernel.limits
      );
      return { circuitState, limits: kernel.limits, portfolio: pf };
    },
  });

/** Kernel tools. Registered unless KERNEL_TOOLS=false. */
export const createKernelTools = (): AnyTool[] => [
  createStateTool(),
  createSetupsTool(),
  createProposeTool(),
  createExecuteTool(),
  createPortfolioTool(),
  createRiskStatusTool(),
];

export const KERNEL_DEFAULTS = DEFAULT_RISK_LIMITS;
