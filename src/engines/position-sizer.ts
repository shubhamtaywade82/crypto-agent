import { dec, floorToStep } from '../domain/primitives.js';
import type { TradeDirection } from '../domain/primitives.js';
import type { ContractSpec } from '../domain/futures/contract-spec.js';
import type { RiskLimits } from '../domain/risk/risk-config.js';

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

const resolveQuantity = (
  input: SizingInput,
  riskBudget: number,
  costs: CostModel,
  warnings: string[]
): number | string => {
  const entry = dec(input.entry);
  const rawQty = dec(riskBudget).dividedBy(costs.effectiveRiskPerUnit);
  let qty = floorToStep(rawQty, dec(input.spec.lotSize));
  if (qty.lt(input.spec.minQuantity)) {
    return `quantity ${qty.toFixed(6)} below min ${input.spec.minQuantity}`;
  }
  let notional = qty.times(entry);
  if (notional.lt(input.spec.minNotional)) {
    const minQty = floorToStep(dec(input.spec.minNotional).dividedBy(entry), dec(input.spec.lotSize));
    const bumped = minQty.gte(input.spec.minQuantity) ? minQty : dec(input.spec.minQuantity);
    if (bumped.times(costs.effectiveRiskPerUnit).gt(dec(riskBudget).times(1.02))) {
      return 'min notional would exceed risk budget';
    }
    qty = bumped;
    warnings.push('quantity bumped to exchange minimum notional');
  }
  const cap = Math.min(input.limits.maxNotionalPerTrade, input.spec.maxQuantity * input.entry);
  if (qty.times(entry).gt(dec(cap))) {
    qty = floorToStep(dec(cap).dividedBy(entry), dec(input.spec.lotSize));
    warnings.push('quantity reduced by max notional cap');
    if (qty.lt(input.spec.minQuantity)) return 'max notional cap below min quantity';
  }
  return qty.toNumber();
};

/**
 * Professional sizing pipeline:
 * equity -> risk budget -> stop distance -> fees -> slippage -> funding
 * -> lot-step quantity -> min-notional -> notional cap -> margin/leverage
 * -> final risk validation. Every adjustment is conservative (risk first).
 */
export const sizePosition = (input: SizingInput): SizingResult => {
  const warnings: string[] = [];
  const riskBudget = dec(input.equity)
    .times(input.limits.maxRiskPerTradePercent).dividedBy(100)
    .times(input.circuitMultiplier).toNumber();
  if (riskBudget <= 0) return fail(input, 'zero risk budget (circuit state)', warnings);

  const stopDistance = Math.abs(input.entry - input.stop);
  if (stopDistance <= 0) return fail(input, 'stop distance must be positive', warnings);

  const costs = buildCosts(input, stopDistance);
  const qty = resolveQuantity(input, riskBudget, costs, warnings);
  if (typeof qty === 'string') return fail(input, qty, warnings);

  const notional = qty * input.entry;
  const leverage = Math.max(1, Math.min(
    input.requestedLeverage, input.limits.maxLeverage, input.spec.maxLeverage
  ));
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
