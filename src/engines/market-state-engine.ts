import type { Candle, MarketState, Timeframe } from '../domain/market/types.js';
import { TIMEFRAMES } from '../domain/market/types.js';
import type { IMarketDataProvider } from '../infrastructure/broker/broker.js';
import { buildMtfState, type MtfResult } from './mtf-engine.js';

const CANDLE_LIMITS: Readonly<Record<Timeframe, number>> = {
  '5m': 300,
  '15m': 300,
  '1h': 300,
  '4h': 220,
};

const fetchCandles = async (
  provider: IMarketDataProvider,
  symbol: string,
  tfs: readonly Timeframe[]
): Promise<Record<Timeframe, Candle[]>> => {
  const entries = await Promise.all(
    tfs.map(async (tf) => [tf, await provider.getKlines(symbol, tf, CANDLE_LIMITS[tf])] as const)
  );
  return Object.fromEntries(entries) as Record<Timeframe, Candle[]>;
};

export interface BuildStateOptions {
  readonly btcSymbol?: string;
  /** Quote currency used to display prices (informational). */
  readonly quote?: string;
}

/**
 * Canonical MarketState builder: pulls the multi-timeframe ladder,
 * BTC macro ladder, funding, OI and mark/index from the (Binance)
 * market-data provider and assembles deterministic intelligence.
 */
export const buildMarketState = async (
  provider: IMarketDataProvider,
  symbol: string,
  opts: BuildStateOptions = {}
): Promise<MtfResult> => {
  const btcSymbol = opts.btcSymbol ?? 'BTCUSDT';
  const [candles, btcCandles, last, markIndex, funding, oi] = await Promise.all([
    fetchCandles(provider, symbol, TIMEFRAMES),
    fetchCandles(provider, btcSymbol, TIMEFRAMES),
    provider.getTickerPrice(symbol),
    provider.getMarkIndex(symbol),
    provider.getFundingRate(symbol),
    provider.getOpenInterest(symbol),
  ]);

  return buildMtfState({
    symbol,
    candles,
    btcCandles,
    price: { last, mark: markIndex.mark, index: markIndex.index },
    futures: {
      fundingRate: funding,
      openInterest: oi.oi,
      openInterestChange: oi.changePct,
    },
  });
};

export const marketStateOf = (mtf: MtfResult): MarketState => mtf.state;
