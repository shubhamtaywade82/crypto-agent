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

/** Known exchange price precision (number of decimal places) by symbol. */
export const SYMBOL_PRECISION: Readonly<Record<string, number>> = {
  BTCUSDT: 1,
  ETHUSDT: 2,
  SOLUSDT: 2,
  BNBUSDT: 2,
  AVAXUSDT: 2,
  LINKUSDT: 3,
  DOTUSDT: 3,
  NEARUSDT: 3,
  XRPUSDT: 4,
  ADAUSDT: 4,
  DOGEUSDT: 4,
  SUIUSDT: 4,
  PEPEUSDT: 7,
  SHIBUSDT: 8,
};

/**
 * Resolve display precision for a price or numerical value.
 * Preserves exact precision (e.g. 0.0, 0.00, 0.000, 0.0000) rather than dropping zeros.
 */
export const resolvePrecision = (
  value: Decimal | number | string,
  precisionOrSymbol?: number | string
): number => {
  if (typeof precisionOrSymbol === 'number' && Number.isFinite(precisionOrSymbol)) {
    return Math.min(20, Math.max(0, Math.floor(precisionOrSymbol)));
  }
  if (typeof precisionOrSymbol === 'string' && precisionOrSymbol.length > 0) {
    const key = precisionOrSymbol.toUpperCase().replace(/^B-/, '').replace('_', '');
    const symKey = key.endsWith('USDT') ? key : `${key}USDT`;
    const known = SYMBOL_PRECISION[symKey] ?? SYMBOL_PRECISION[key];
    if (known !== undefined) return known;
  }
  if (typeof value === 'string' && value.includes('.')) {
    return Math.min(20, value.split('.')[1]?.length ?? 2);
  }
  if (value instanceof Decimal) {
    return Math.min(20, Math.max(2, value.decimalPlaces()));
  }
  const n = typeof value === 'number' ? value : Number(value);
  if (Number.isFinite(n)) {
    const s = n.toString();
    if (s.includes('.')) return Math.min(20, Math.max(2, s.split('.')[1]?.length ?? 2));
    if (Math.abs(n) >= 1) return 2;
    if (Math.abs(n) >= 0.1) return 3;
    if (Math.abs(n) >= 0.01) return 4;
    return 6;
  }
  return 2;
};

/**
 * Format a price or value maintaining exact decimal precision (never strip trailing zeros).
 * Keeps thousands grouping with fixed decimal places (e.g. 6 -> "6.0", "6.00", "6.000").
 */
export const formatPrecision = (
  value: Decimal | number | string,
  precisionOrSymbol?: number | string
): string => {
  const n = typeof value === 'number' ? value : value instanceof Decimal ? value.toNumber() : Number(value);
  if (!Number.isFinite(n)) return '—';
  const dp = resolvePrecision(value, precisionOrSymbol);
  return n.toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp });
};

/** Floor a value down to the exchange step size (lot size / tick size). */
export const floorToStep = (value: Decimal, step: Decimal): Decimal => {
  if (step.lte(0)) return value;
  return value.div(step).toDecimalPlaces(0, Decimal.ROUND_DOWN).times(step);
};

/**
 * Ceil a value up to the exchange step size. Required when satisfying a
 * MINIMUM (e.g. min-notional): flooring can leave the quantity just below
 * the required minimum, while ceiling guarantees the floor constraint holds.
 */
export const ceilToStep = (value: Decimal, step: Decimal): Decimal => {
  if (step.lte(0)) return value;
  return value.div(step).toDecimalPlaces(0, Decimal.ROUND_UP).times(step);
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
