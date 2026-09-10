import type { Candle, MarketState, Timeframe } from '../domain/market/types.js';
import { TIMEFRAMES } from '../domain/market/types.js';
import type { IMarketDataProvider } from '../infrastructure/broker/broker.js';
import { buildMtfState, type MtfResult } from './mtf-engine.js';
import type { MarketStateStore } from './market-state-store.js';
import { computeMicrostructure } from './microstructure-engine.js';

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
  const [candles, btcCandles, last, markIndex, funding, oi, depth, trades] = await Promise.all([
    fetchCandles(provider, symbol, TIMEFRAMES),
    fetchCandles(provider, btcSymbol, TIMEFRAMES),
    provider.getTickerPrice(symbol),
    provider.getMarkIndex(symbol),
    provider.getFundingRate(symbol),
    provider.getOpenInterest(symbol),
    provider.getOrderBookDepth(symbol, 20),
    provider.getAggTrades(symbol, 50),
  ]);
  const micro = depth.bids.length > 0 && depth.asks.length > 0
    ? computeMicrostructure(depth, trades, last)
    : undefined;

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
    microstructure: micro,
  });
};

export const marketStateOf = (mtf: MtfResult): MarketState => mtf.state;

/**
 * Event-driven path: assemble the MTF ladder purely from the WS-fed store
 * (zero REST calls). Returns undefined whenever the store cannot fully
 * serve BOTH ladders and the price triple, so the caller falls back to the
 * REST builder — a partial ladder is never traded on.
 */
export const buildMtfFromStore = (
  store: MarketStateStore,
  symbol: string,
  opts: BuildStateOptions = {}
): MtfResult | undefined => {
  const btcSymbol = opts.btcSymbol ?? 'BTCUSDT';
  const snap = store.snapshot(symbol);
  const btc = store.snapshot(btcSymbol);
  if (!snap || !btc) return undefined;
  if (!servesIndicators(snap) || !servesIndicators(btc)) return undefined;
  if (snap.last === undefined || snap.mark === undefined || snap.index === undefined) {
    return undefined;
  }
  return buildMtfState({
    symbol,
    candles: snap.candles,
    btcCandles: btc.candles,
    price: { last: snap.last, mark: snap.mark, index: snap.index },
    futures: {
      fundingRate: snap.fundingRate ?? 0,
      openInterest: snap.openInterest ?? 0,
      openInterestChange: snap.openInterestChange ?? 0,
    },
    microstructure: snap.microstructure,
  });
};

/** Indicator sanity: every timeframe carries enough history for EMA200. */
const servesIndicators = (
  snap: NonNullable<ReturnType<MarketStateStore['snapshot']>>
): boolean =>
  TIMEFRAMES.every((tf) => (snap.candles[tf]?.length ?? 0) >= 200);
