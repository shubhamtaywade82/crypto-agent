import { dec } from '../primitives.js';

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
  maxLeverage: 5,
  maintenanceMarginRate: 0.005,
});

export const specFromInstrument = (i: {
  pair: string;
  base_currency?: string;
  quote_currency?: string;
  tick_size?: number;
  lot_size?: number;
  min_quantity?: number;
  max_quantity?: number;
  max_leverage?: number;
  maintenance_margin?: number;
}): ContractSpec => {
  const parts = i.pair.split('_');
  const base = i.base_currency ?? parts[0]?.replace(/^[^-]-/, '') ?? 'BASE';
  const quote = i.quote_currency ?? parts[1] ?? 'USDT';
  return {
    pair: i.pair,
    baseAsset: base,
    quoteAsset: quote,
    tickSize: i.tick_size && i.tick_size > 0 ? i.tick_size : 0.01,
    lotSize: i.lot_size && i.lot_size > 0 ? i.lot_size : 0.01,
    minQuantity: i.min_quantity ?? 0.01,
    maxQuantity: i.max_quantity ?? 10_000,
    minNotional: 20,
    maxLeverage: i.max_leverage ?? 5,
    maintenanceMarginRate: i.maintenance_margin ?? 0.005,
  };
};

/** Round price to the instrument tick size (nearest). */
export const roundToTick = (price: number, spec: ContractSpec): number => {
  const tick = dec(spec.tickSize);
  if (tick.lte(0)) return price;
  return dec(price).div(tick).toDecimalPlaces(0).times(tick).toNumber();
};
