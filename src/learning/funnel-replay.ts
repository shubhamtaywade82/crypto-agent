import type { Candle, Timeframe } from '../domain/market/types.js';
import { TIMEFRAMES } from '../domain/market/types.js';
import type { RiskLimits } from '../domain/risk/risk-config.js';
import { buildMtfState } from '../engines/mtf-engine.js';
import { evaluateFunnelBar } from './funnel-gates.js';
import { aggregateFunnel } from './funnel-aggregate.js';
import type { FunnelReport, SetupFunnelObservation } from './funnel-types.js';
import type { IMarketDataProvider } from '../infrastructure/broker/broker.js';

export interface SetupFunnelOptions {
  readonly symbol: string;
  readonly candles: Readonly<Record<Timeframe, readonly Candle[]>>;
  readonly btcCandles: Readonly<Record<Timeframe, readonly Candle[]>>;
  readonly limits: RiskLimits;
  readonly stepBars?: number;
  readonly minBaseBars?: number;
}

const WINDOW: Readonly<Record<Timeframe, number>> = {
  '5m': 300, '15m': 300, '1h': 300, '4h': 220,
};

const sliceAll = (
  ladder: Readonly<Record<Timeframe, readonly Candle[]>>, until: number
): Record<Timeframe, readonly Candle[]> => {
  const out = {} as Record<Timeframe, readonly Candle[]>;
  for (const tf of TIMEFRAMES) {
    const kept = ladder[tf].filter((c) => c.openTime <= until);
    out[tf] = kept.slice(Math.max(0, kept.length - WINDOW[tf]));
  }
  return out;
};

const hasHistory = (sliced: Record<Timeframe, readonly Candle[]>): boolean =>
  TIMEFRAMES.every((tf) => sliced[tf].length >= 200);

export const runSetupFunnel = (opts: SetupFunnelOptions): FunnelReport => {
  const step = opts.stepBars ?? 1;
  const minBase = opts.minBaseBars ?? 260;
  const base = opts.candles['5m'];
  const rows: SetupFunnelObservation[] = [];
  for (let i = minBase; i < base.length; i += step) {
    const until = base[i]!.openTime;
    const sliced = sliceAll(opts.candles, until);
    const btc = sliceAll(opts.btcCandles, until);
    if (!hasHistory(sliced) || !hasHistory(btc)) continue;
    const close = base[i]!.close;
    const mtf = buildMtfState({
      symbol: opts.symbol, candles: sliced, btcCandles: btc,
      price: { last: close, mark: close, index: close },
      futures: { fundingRate: 0, openInterest: 0, openInterestChange: 0 },
    });
    rows.push(evaluateFunnelBar(mtf, opts.limits, until));
  }
  return aggregateFunnel(rows, opts.symbol);
};

export const runSetupFunnelFromProvider = async (
  provider: IMarketDataProvider,
  symbol: string,
  limits: RiskLimits,
  opts: { readonly btcSymbol?: string; readonly stepBars?: number } = {}
): Promise<FunnelReport> => {
  const btcSymbol = opts.btcSymbol ?? 'BTCUSDT';
  const backfill = async (sym: string): Promise<Record<Timeframe, readonly Candle[]>> => ({
    '5m': await provider.getKlines(sym, '5m', 1500),
    '15m': await provider.getKlines(sym, '15m', 500),
    '1h': await provider.getKlines(sym, '1h', 400),
    '4h': await provider.getKlines(sym, '4h', 300),
  });
  return runSetupFunnel({
    symbol,
    candles: await backfill(symbol),
    btcCandles: await backfill(btcSymbol),
    limits,
    stepBars: opts.stepBars ?? 1,
    minBaseBars: 300,
  });
};
