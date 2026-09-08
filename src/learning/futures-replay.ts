import { FALLBACK_SPEC, type ContractSpec } from '../domain/futures/contract-spec.js';
import type { RiskLimits } from '../domain/risk/risk-config.js';
import type { TradeOutcomeRecord } from './trade-ledger.js';

/**
 * TRUE futures replay surface (V3.1 P0-3): the walk-forward simulator
 * models the real execution constraints the live kernel trades under —
 * contract minima and lot rounding, leverage caps, per-side taker fees,
 * per-side slippage on fill prices, signed funding over holding periods
 * and margin utilization — so research cells behave like live cells.
 */

/** One simulated trade with FULL futures replay accounting. */
export interface SimulatedTrade {
  readonly decisionId: string;
  readonly setupType: string;
  readonly direction: 'LONG' | 'SHORT';
  readonly regime: string;
  readonly entry: number;
  readonly stopLoss: number;
  readonly takeProfit: number;
  readonly rMultiple: number;
  readonly maxAdverseR: number;
  readonly maxFavorableR: number;
  readonly outcome: 'TARGET' | 'STOP' | 'TIMEOUT';
  readonly openedAt: number;
  readonly closedAt: number;
  /** TRUE futures replay accounting (0/1 placeholders in legacy mode). */
  readonly quantity: number;
  readonly notional: number;
  readonly leverage: number;
  readonly riskAmount: number;
  readonly feesPaid: number;
  readonly fundingPaid: number;
  /** Chronological sample split: in-sample or out-of-sample. */
  readonly sample: 'IS' | 'OOS';
}

/** Map a simulated trade into the learning layer's outcome shape. */
export const toRecord = (t: SimulatedTrade, symbol: string): TradeOutcomeRecord => ({
  ...t,
  symbol,
  strategyId: t.setupType,
  plannedRr: Math.abs(t.entry - t.stopLoss) > 0
    ? Math.abs(t.takeProfit - t.entry) / Math.abs(t.entry - t.stopLoss)
    : 0,
  fundingRate: 0,
  leverage: t.leverage || 1,
  riskAmount: t.riskAmount || 1, // outcomes are expressed in R
  notional: t.notional || t.entry,
  confidence: 0,
  pnl: t.rMultiple,
  holdingMinutes: Math.max(0, (t.closedAt - t.openedAt) / 60_000),
  openedAt: t.openedAt,
  closedAt: t.closedAt,
});

export interface FuturesReplayConfig {
  /** Venue contract constraints (lot rounding, minima, leverage cap). */
  readonly spec: ContractSpec;
  /** Replay account equity in canonical USDT. */
  readonly equityUsdt: number;
  /** Fraction of equity risked per trade (0.0025 = 0.25%). */
  readonly riskPerTradePct: number;
  /** Requested leverage (capped by spec.maxLeverage). */
  readonly leverage: number;
  /** Taker fee rate per side (e.g. 0.0005 = 0.05%). */
  readonly takerFeeRate: number;
  /** Per-side execution slippage applied to fill prices (bps). */
  readonly slippageBps: number;
  /** Signed per-8h funding rate; LONGS pay when positive. */
  readonly fundingRate8h: number;
  readonly fundingIntervalHours: number;
  /** Max concurrently open simulated positions. */
  readonly maxConcurrentPositions: number;
  /** Max fraction of equity usable as margin. */
  readonly maxMarginUtilizationPct: number;
}

/** Default futures replay surface derived from the LIVE risk limits. */
export const defaultReplayConfig = (symbol: string, limits: RiskLimits): FuturesReplayConfig => ({
  spec: FALLBACK_SPEC(symbol.replace(/USDT$/, '')),
  equityUsdt: 10_000,
  riskPerTradePct: limits.maxRiskPerTradePercent / 100,
  leverage: Math.min(3, limits.maxLeverage),
  takerFeeRate: limits.feeRateTaker,
  slippageBps: limits.slippageBufferRate * 10_000,
  fundingRate8h: 0.0001,
  fundingIntervalHours: 8,
  maxConcurrentPositions: limits.maxConcurrentPositions,
  maxMarginUtilizationPct: 0.8,
});

export interface SizedPosition {
  readonly ok: boolean;
  readonly reason?: string;
  readonly quantity: number;
  readonly notional: number;
  readonly leverage: number;
  readonly riskAmount: number;
}

const unsized = (reason: string, riskAmount: number, notional = 0, leverage = 0): SizedPosition =>
  ({ ok: false, reason, quantity: 0, notional, leverage, riskAmount });

/**
 * Contract-constrained sizing: risk-based quantity rounded DOWN to the
 * lot step, exchange minima enforced, leverage capped by the venue spec,
 * margin bounded by the utilization cap. A trade that cannot be sized
 * within real constraints is NEVER simulated (the live kernel would
 * reject it too).
 */
export const sizeReplayPosition = (
  cfg: FuturesReplayConfig, entry: number, stop: number
): SizedPosition => {
  const risk = Math.abs(entry - stop);
  if (risk <= 0) return unsized('non-positive risk distance', 0);
  const riskAmount = cfg.equityUsdt * cfg.riskPerTradePct;
  const step = cfg.spec.lotSize > 0 ? cfg.spec.lotSize : 0.001;
  const quantity = Math.floor(riskAmount / risk / step) * step;
  if (quantity < cfg.spec.minQuantity) {
    return unsized(`quantity ${quantity} below min ${cfg.spec.minQuantity}`, riskAmount);
  }
  const notional = quantity * entry;
  if (notional < cfg.spec.minNotional) {
    return unsized(
      `notional ${notional.toFixed(2)} below min ${cfg.spec.minNotional}`, riskAmount, notional
    );
  }
  const leverage = Math.max(1, Math.min(cfg.leverage, cfg.spec.maxLeverage));
  const margin = notional / leverage;
  if (margin > cfg.equityUsdt * cfg.maxMarginUtilizationPct) {
    return unsized(`margin ${margin.toFixed(2)} exceeds utilization cap`, riskAmount, notional, leverage);
  }
  return { ok: true, quantity, notional, leverage, riskAmount };
};

/** Fill price with per-side slippage: `worse` = +1 makes the fill worse. */
export const slipped = (price: number, worse: 1 | -1, slippageBps: number): number =>
  price * (1 + worse * slippageBps / 10_000);

export interface SimAccounting {
  readonly rMultiple: number;
  readonly quantity: number;
  readonly notional: number;
  readonly leverage: number;
  readonly riskAmount: number;
  readonly feesPaid: number;
  readonly fundingPaid: number;
}

interface SimTradeLike {
  readonly direction: 'LONG' | 'SHORT';
  readonly entry: number;
  readonly stopLoss: number;
}

interface SimResolutionLike {
  readonly exit: number;
  readonly holdingBars: number;
}

const toR = (entry: number, stop: number, exit: number, direction: 'LONG' | 'SHORT'): number => {
  const risk = Math.abs(entry - stop);
  if (risk <= 0) return 0;
  const move = direction === 'LONG' ? exit - entry : entry - exit;
  return move / risk;
};

/** Legacy mode: flat cost in R, nominal riskAmount 1, no position math. */
export const legacyAccounting = (
  trade: SimTradeLike, res: SimResolutionLike, costR: number
): SimAccounting => ({
  rMultiple: toR(trade.entry, trade.stopLoss, res.exit, trade.direction) - costR,
  quantity: 0, notional: trade.entry, leverage: 1, riskAmount: 1, feesPaid: 0, fundingPaid: 0,
});

/**
 * TRUE futures accounting: entry/exit fills slip against the direction,
 * taker fees charge both legs, signed funding accrues over whole funding
 * periods held, and R is realized PnL divided by the authorized risk.
 */
export const futuresAccounting = (
  trade: SimTradeLike, res: SimResolutionLike, cfg: FuturesReplayConfig
): SimAccounting => {
  const sized = sizeReplayPosition(cfg, trade.entry, trade.stopLoss);
  if (!sized.ok) {
    return { rMultiple: 0, quantity: 0, notional: 0, leverage: 0, riskAmount: 0, feesPaid: 0, fundingPaid: 0 };
  }
  const { quantity, notional, leverage, riskAmount } = sized;
  const long = trade.direction === 'LONG';
  const dir = long ? 1 : -1;
  const entryFill = slipped(trade.entry, long ? 1 : -1, cfg.slippageBps);
  const exitFill = slipped(res.exit, long ? -1 : 1, cfg.slippageBps);
  const movePnl = (exitFill - entryFill) * dir * quantity;
  const fees = (entryFill + exitFill) * quantity * cfg.takerFeeRate;
  const periods = Math.floor(
    (res.holdingBars * 5) / (cfg.fundingIntervalHours * 60) // 5m base ladder
  );
  // Longs PAY positive funding; shorts receive it (and vice versa).
  const funding = notional * cfg.fundingRate8h * periods * (long ? 1 : -1);
  const pnl = movePnl - fees - funding;
  return {
    rMultiple: riskAmount > 0 ? pnl / riskAmount : 0,
    quantity, notional, leverage, riskAmount,
    feesPaid: fees, fundingPaid: funding,
  };
};
