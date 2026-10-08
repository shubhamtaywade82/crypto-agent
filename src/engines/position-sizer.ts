import { dec, floorToStep, ceilToStep, maxD, minD } from '../domain/primitives.js';
import type { D, TradeDirection } from '../domain/primitives.js';
import type { ContractSpec } from '../domain/futures/contract-spec.js';
import type { RiskLimits } from '../domain/risk/risk-config.js';
import { MIN_LEVERAGE } from './leverage-policy.js';

export interface SizingInput {
  readonly equity: number;
  readonly availableMargin: number;
  readonly direction: TradeDirection;
  readonly entry: number;
  readonly stop: number;
  readonly requestedLeverage: number;
  /** Per-8h funding rate (e.g. 0.0001 = 0.01%). */
  readonly fundingRate?: number;
  /** Expected holding time in 8h funding periods (default 3). */
  readonly fundingPeriods?: number;
  readonly spec: ContractSpec;
  readonly limits: RiskLimits;
  readonly circuitMultiplier: number;
}

export interface SizingResult {
  readonly ok: boolean;
  readonly rejection?: string;
  readonly quantity: number;
  readonly notional: number;
  readonly marginRequired: number;
  readonly leverage: number;
  readonly riskAmount: number;
  readonly effectiveRiskPerUnit: number;
  readonly feePerUnit: number;
  readonly fundingPerUnit: number;
  readonly warnings: readonly string[];
}

const fail = (input: SizingInput, rejection: string, warnings: readonly string[] = []): SizingResult => ({
  ok: false, rejection, quantity: 0, notional: 0, marginRequired: 0,
  leverage: Math.min(input.requestedLeverage, input.limits.maxLeverage, input.spec.maxLeverage),
  riskAmount: 0, effectiveRiskPerUnit: 0, feePerUnit: 0, fundingPerUnit: 0, warnings,
});

/** A sizing failure produced before any sizing input exists (e.g. the real instrument spec was unavailable). */
export const failedSizing = (rejection: string): SizingResult => ({
  ok: false, rejection, quantity: 0, notional: 0, marginRequired: 0,
  leverage: 0, riskAmount: 0, effectiveRiskPerUnit: 0, feePerUnit: 0, fundingPerUnit: 0,
  warnings: [],
});

interface CostModel {
  readonly feePerUnit: number;
  readonly fundingPerUnit: number;
  readonly effectiveRiskPerUnit: number;
}

const buildCosts = (input: SizingInput, stopDistance: number): CostModel => {
  const entry = dec(input.entry);
  const feePerUnit = entry.times(input.limits.feeRateTaker + input.limits.slippageBufferRate).times(2);
  const periods = input.fundingPeriods ?? 3;
  const fundingPerUnit = entry.times(Math.abs(input.fundingRate ?? 0)).times(periods);
  return {
    feePerUnit: feePerUnit.toNumber(),
    fundingPerUnit: fundingPerUnit.toNumber(),
    effectiveRiskPerUnit: stopDistance + feePerUnit.toNumber() + fundingPerUnit.toNumber(),
  };
};

/**
 * Notional ceiling: the tightest of the per-trade cap, the per-symbol share of
 * equity, and the venue's own maximum size. Without the equity share a single
 * symbol could be sized far past the exposure envelope.
 */
const notionalCap = (input: SizingInput): D => minD(
  dec(input.limits.maxNotionalPerTrade),
  dec(input.equity).times(input.limits.maxSymbolExposurePercent).dividedBy(100),
  dec(input.spec.maxQuantity).times(input.entry),
);

/**
 * Lift a quantity to the venue minimum notional, rounded UP to the lot step
 * (flooring could leave it just below the minimum). The bump must stay inside
 * the risk budget; the 2% tolerance only absorbs lot rounding.
 */
const bumpToMinNotional = (input: SizingInput, riskBudget: number, costs: CostModel): D | string => {
  const lot = dec(input.spec.lotSize);
  const byNotional = ceilToStep(dec(input.spec.minNotional).dividedBy(input.entry), lot);
  const bumped = ceilToStep(maxD(byNotional, dec(input.spec.minQuantity)), lot);
  if (bumped.times(costs.effectiveRiskPerUnit).gt(dec(riskBudget).times(1.02))) {
    return 'min notional would exceed risk budget';
  }
  return bumped;
};

/** Budget-driven quantity on the lot grid, lifted to venue minimum notional when needed. */
const resolveQuantity = (
  input: SizingInput,
  riskBudget: number,
  costs: CostModel,
  warnings: string[]
): number | string => {
  const entry = dec(input.entry);
  const lot = dec(input.spec.lotSize);
  let qty = floorToStep(dec(riskBudget).dividedBy(costs.effectiveRiskPerUnit), lot);
  if (qty.lt(input.spec.minQuantity)) {
    return `quantity ${qty.toFixed(6)} below min ${input.spec.minQuantity}`;
  }
  if (qty.times(entry).lt(input.spec.minNotional)) {
    const bumped = bumpToMinNotional(input, riskBudget, costs);
    if (typeof bumped === 'string') return bumped;
    qty = bumped;
    warnings.push('quantity bumped to exchange minimum notional');
  }
  const cap = notionalCap(input);
  if (qty.times(entry).gt(cap)) {
    qty = floorToStep(cap.dividedBy(entry), lot);
    warnings.push('quantity reduced by notional cap');
  }
  if (qty.lt(input.spec.minQuantity)) return 'notional cap below min quantity';
  // The cap runs after the bump and can pull notional back under the venue minimum.
  if (qty.times(entry).lt(input.spec.minNotional)) return 'notional cap below min notional';
  return qty.toNumber();
};

/**
 * Leverage stays inside the policy band. A ceiling below the band floor means
 * the venue cannot support the band, so the trade is refused rather than
 * silently run at a leverage the policy does not allow.
 */
const resolveLeverage = (input: SizingInput): number | string => {
  const ceiling = Math.min(input.limits.maxLeverage, input.spec.maxLeverage);
  if (ceiling < MIN_LEVERAGE) return `leverage ceiling ${ceiling} below band floor ${MIN_LEVERAGE}`;
  return Math.min(Math.max(input.requestedLeverage, MIN_LEVERAGE), ceiling);
};

const riskBudgetOf = (input: SizingInput): number =>
  dec(input.equity)
    .times(input.limits.maxRiskPerTradePercent).dividedBy(100)
    .times(input.circuitMultiplier).toNumber();

/**
 * Professional sizing pipeline:
 * equity -> risk budget -> stop distance -> fees -> slippage -> funding
 * -> lot-step quantity -> min-notional -> notional cap -> leverage band
 * -> margin -> final risk validation. Every adjustment is conservative (risk first).
 */
export const sizePosition = (input: SizingInput): SizingResult => {
  const warnings: string[] = [];
  const riskBudget = riskBudgetOf(input);
  if (riskBudget <= 0) return fail(input, 'zero risk budget (circuit state)', warnings);

  const stopDistance = Math.abs(input.entry - input.stop);
  if (stopDistance <= 0) return fail(input, 'stop distance must be positive', warnings);

  const costs = buildCosts(input, stopDistance);
  const qty = resolveQuantity(input, riskBudget, costs, warnings);
  if (typeof qty === 'string') return fail(input, qty, warnings);

  const leverage = resolveLeverage(input);
  if (typeof leverage === 'string') return fail(input, leverage, warnings);

  const notional = qty * input.entry;
  const marginRequired = notional / leverage;
  if (marginRequired > input.availableMargin) {
    return fail(input, 'insufficient available margin', warnings);
  }
  const riskAmount = qty * costs.effectiveRiskPerUnit;
  if (riskAmount > riskBudget * 1.02) {
    return fail(input, 'final risk exceeds risk budget', warnings);
  }
  return {
    ok: true, quantity: qty, notional, marginRequired, leverage,
    riskAmount, effectiveRiskPerUnit: costs.effectiveRiskPerUnit,
    feePerUnit: costs.feePerUnit, fundingPerUnit: costs.fundingPerUnit, warnings,
  };
};
