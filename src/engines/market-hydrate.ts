import type { IMarketDataProvider } from '../infrastructure/broker/broker.js';
import type { MarketStateStore } from './market-state-store.js';
import { getKernel } from '../kernel.js';
import { kernelWatchSymbols } from '../kernel-streams.js';

/** REST seed of depth + agg-trade tape into the shared market store. */
export const hydrateSymbolMicro = async (
  provider: IMarketDataProvider,
  store: MarketStateStore,
  symbol: string
): Promise<boolean> => {
  const sym = symbol.toUpperCase();
  try {
    const at = Date.now();
    const [depth, trades] = await Promise.all([
      provider.getOrderBookDepth(sym, 20),
      provider.getAggTrades(sym, 50),
    ]);
    if (depth.bids.length === 0 || depth.asks.length === 0) return false;
    store.setDepth({ symbol: sym, bids: depth.bids, asks: depth.asks, at });
    for (const t of trades) store.pushTrade(sym, t);
    return true;
  } catch {
    return false;
  }
};

export const hydrateWatchMicro = async (): Promise<void> => {
  const kernel = getKernel();
  for (const sym of kernelWatchSymbols()) {
    const snap = kernel.marketStore.snapshot(sym);
    if ((snap?.bids.length ?? 0) > 0) continue;
    await hydrateSymbolMicro(kernel.provider, kernel.marketStore, sym);
  }
};

/** Subscribe on the WS multiplexer (reconnect if needed) and REST-fill depth/tape. */
export const ensureSymbolTracked = async (symbol: string): Promise<boolean> => {
  const kernel = getKernel();
  const sym = symbol.toUpperCase();
  await kernel.streams.market?.ensure(sym);
  if ((kernel.marketStore.snapshot(sym)?.bids.length ?? 0) === 0) {
    await hydrateSymbolMicro(kernel.provider, kernel.marketStore, sym);
  }
  return (kernel.marketStore.snapshot(sym)?.bids.length ?? 0) > 0;
};
