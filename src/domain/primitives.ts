import { Decimal } from 'decimal.js';

Decimal.set({ precision: 40, rounding: Decimal.ROUND_HALF_UP });

/** Canonical decimal type used across the trading kernel. */
export type D = Decimal;
export const dec = (value: Decimal.Value): Decimal => new Decimal(value);
export const ZERO = dec(0);
export const ONE = dec(1);

export const num = (value: Decimal | number): number =>
  value instanceof Decimal ? value.toNumber() : value;

/** Format a decimal with fixed decimal places (string, exchange-safe). */
export const fmt = (value: Decimal | number, dp = 8): string =>
  (value instanceof Decimal ? value : dec(value)).toDecimalPlaces(dp, Decimal.ROUND_DOWN).toFixed(dp);

/** Floor a value down to the exchange step size (lot size / tick size). */
export const floorToStep = (value: Decimal, step: Decimal): Decimal => {
  if (step.lte(0)) return value;
  return value.div(step).toDecimalPlaces(0, Decimal.ROUND_DOWN).times(step);
};

/** Percentage of an amount: pctOf(10000, 0.5) => 50 */
export const pctOf = (amount: Decimal, percent: Decimal): Decimal =>
  amount.times(percent).dividedBy(100);

export const abs = (value: Decimal): Decimal => value.abs();
export const maxD = (...values: Decimal[]): Decimal => Decimal.max(...values);
export const minD = (...values: Decimal[]): Decimal => Decimal.min(...values);

export const isPositive = (value: Decimal): boolean => value.gt(0);
export const greaterThan = (a: Decimal, b: Decimal): boolean => a.gt(b);
export const lessThan = (a: Decimal, b: Decimal): boolean => a.lt(b);

/** Side of a trade as seen by the account. */
export type TradeDirection = 'LONG' | 'SHORT';

export const opposing = (side: TradeDirection): 'LONG' | 'SHORT' =>
  side === 'LONG' ? 'SHORT' : 'LONG';

/** Deterministic id: <prefix>_<ms36>_<rand6> */
export const makeId = (prefix: string): string => {
  const rand = Math.random().toString(36).slice(2, 8).padEnd(6, '0');
  return `${prefix}_${Date.now().toString(36)}_${rand}`;
};
