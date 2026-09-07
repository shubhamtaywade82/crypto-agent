import { dec } from '../primitives.js';
import type { TradeDirection } from '../primitives.js';

/**
 * Deterministic position view: answers, for any position,
 * "what is my entry / mark / liq price / leverage / margin / uPnL / fees /
 * worst-case loss?" without contacting an exchange.
 */
export interface PositionView {
  readonly positionId: string;
  readonly symbol: string;
  readonly pair: string;
  readonly direction: TradeDirection;
  readonly quantity: number;
  readonly entryPrice: number;
  readonly markPrice: number;
  readonly liquidationPrice: number;
  readonly leverage: number;
  readonly margin: number;
  readonly unrealizedPnl: number;
  readonly unrealizedPnlPercent: number;
  readonly feesPaid: number;
  readonly fundingPaid: number;
  /** Loss if liquidation is hit (worst case, isolated margin). */
  readonly worstCaseLoss: number;
  readonly stopLoss?: number;
  readonly takeProfit?: number;
}

/** Isolated-margin liquidation price approximation (MMR included). */
export const liquidationPrice = (
  entry: number,
  leverage: number,
  direction: TradeDirection,
  mmr: number
): number => {
  const e = dec(entry);
  const lev = Math.max(1, leverage);
  const mm = dec(mmr);
  if (direction === 'LONG') {
    return e.times(dec(1).minus(dec(1).dividedBy(lev)).plus(mm)).toNumber();
  }
  return e.times(dec(1).plus(dec(1).dividedBy(lev)).minus(mm)).toNumber();
};

export const unrealizedPnl = (
  direction: TradeDirection,
  entry: number,
  mark: number,
  quantity: number
): number => {
  const diff = direction === 'LONG' ? dec(mark).minus(entry) : dec(entry).minus(mark);
  return diff.times(quantity).toNumber();
};

export const buildPositionView = (
  p: Omit<
    PositionView,
    | 'unrealizedPnl' | 'unrealizedPnlPercent' | 'worstCaseLoss'
    | 'liquidationPrice' | 'margin'
  > & { readonly marginRate?: number }
): PositionView => {
  const liq = liquidationPrice(p.entryPrice, p.leverage, p.direction, p.marginRate ?? 0.005);
  const margin = dec(p.entryPrice).times(p.quantity).dividedBy(p.leverage).toNumber();
  const upnl = unrealizedPnl(p.direction, p.entryPrice, p.markPrice, p.quantity);
  const notional = dec(p.entryPrice).times(p.quantity);
  const worst = p.direction === 'LONG'
    ? dec(p.entryPrice).minus(liq).times(p.quantity).toNumber()
    : dec(liq).minus(p.entryPrice).times(p.quantity).toNumber();
  const pct = notional.gt(0)
    ? dec(upnl).dividedBy(notional).times(100).toNumber()
    : 0;
  return {
    ...p,
    margin,
    liquidationPrice: liq,
    unrealizedPnl: upnl,
    unrealizedPnlPercent: Number(pct.toFixed(4)),
    worstCaseLoss: Math.max(0, worst),
  };
};
