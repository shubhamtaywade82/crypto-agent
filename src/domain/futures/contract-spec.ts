import { dec, ceilToStep, floorToStep } from '../primitives.js';
import type { TradeDirection } from '../primitives.js';
import { computeRr, type TradeProposal } from '../orders/trade-proposal.js';

/** Normalized futures contract constraints (exchange-agnostic). */
export interface ContractSpec {
  readonly pair: string;
  readonly baseAsset: string;
  readonly quoteAsset: string;
  readonly tickSize: number;
  readonly lotSize: number;
  readonly minQuantity: number;
  readonly maxQuantity: number;
  readonly minNotional: number;
  readonly maxLeverage: number;
  readonly maintenanceMarginRate: number;
}

/** Fallback spec used when exchange metadata is unavailable (safe defaults). */
export const FALLBACK_SPEC = (baseAsset: string, quoteAsset = 'USDT'): ContractSpec => ({
  pair: `${baseAsset}_${quoteAsset}`,
  baseAsset,
  quoteAsset,
  tickSize: 0.01,
  lotSize: 0.01,
  minQuantity: 0.01,
  maxQuantity: 10_000,
  minNotional: 20,
  maxLeverage: 15,
  maintenanceMarginRate: 0.005,
});

/**
 * Snap a price onto the venue tick, always toward the side that does not
 * flatter the trade: LONG floors, SHORT ceils. On a stop this moves the level
 * further from entry (risk is never understated); on a target it moves the
 * level toward entry (reward is never overstated). Callers re-validate R:R on
 * the aligned values.
 */
export const alignToTick = (price: number, tickSize: number, direction: TradeDirection): number => {
  if (!Number.isFinite(price)) throw new Error(`cannot align non-finite price ${price}`);
  if (!(tickSize > 0)) throw new Error(`non-positive tick size ${tickSize}`);
  const tick = dec(tickSize);
  const snapped = direction === 'LONG' ? floorToStep(dec(price), tick) : ceilToStep(dec(price), tick);
  return snapped.toNumber();
};

/**
 * Stop and target are venue order levels, so they must sit on the tick. Entry
 * is the reference price the decision was priced against and is not sent as
 * a level; the marketable limit derived from it is aligned at the broker.
 */
export const alignProposalToTick = (proposal: TradeProposal, spec: ContractSpec): TradeProposal => ({
  ...proposal,
  stopLoss: alignToTick(proposal.stopLoss, spec.tickSize, proposal.direction),
  takeProfit: alignToTick(proposal.takeProfit, spec.tickSize, proposal.direction),
});

/**
 * Setup targets are often extended to exactly the R:R floor, so pulling the
 * target toward entry onto the tick drops R:R just under it. Only that
 * alignment-induced shortfall is repaired: the target moves outward to the
 * first tick that clears the floor, measured against the aligned stop. The
 * stop and entry are untouched.
 */
const restoreMinRr = (aligned: TradeProposal, tickSize: number, minRr: number): TradeProposal => {
  const { risk, rr } = computeRr(aligned);
  if (risk <= 0 || rr >= minRr) return aligned;
  const tick = dec(tickSize);
  const long = aligned.direction === 'LONG';
  const reach = dec(risk).times(minRr);
  const required = long ? dec(aligned.entry).plus(reach) : dec(aligned.entry).minus(reach);
  const snapped = long ? ceilToStep(required, tick) : floorToStep(required, tick);
  const clears = (level: number): boolean => computeRr({ ...aligned, takeProfit: level }).rr >= minRr;
  const target = clears(snapped.toNumber()) ? snapped : (long ? snapped.plus(tick) : snapped.minus(tick));
  return { ...aligned, takeProfit: target.toNumber() };
};

/**
 * A spec lookup failure returns the proposal unchanged. Sizing then rejects
 * with INSTRUMENT_SPEC_UNAVAILABLE, so no unaligned level can reach the venue.
 * A proposal that missed the R:R floor on its own prices is not repaired; the
 * validator rejects it as before.
 */
export const alignProposalForVenue = async (
  proposal: TradeProposal,
  specFor: (symbol: string) => Promise<ContractSpec>,
  minRr: number
): Promise<TradeProposal> => {
  let spec: ContractSpec;
  try {
    spec = await specFor(proposal.symbol);
  } catch {
    return proposal;
  }
  const aligned = alignProposalToTick(proposal, spec);
  if (computeRr(proposal).rr < minRr) return aligned;
  return restoreMinRr(aligned, spec.tickSize, minRr);
};
