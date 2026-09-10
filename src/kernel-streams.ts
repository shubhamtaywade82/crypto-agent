import type { CoinDCXClient } from '@nemesis-oss/coindcx-sdk';
import type { IMarketDataProvider } from './infrastructure/broker/broker.js';
import { BinanceMarketStream } from './infrastructure/binance/market-stream.js';
import { CoinDCXAccountStream } from './infrastructure/coindcx/account-stream.js';
import type { EventStore } from './infrastructure/events/event-store.js';
import type { Logger } from './infrastructure/observability/logger.js';
import { MarketStateStore } from './engines/market-state-store.js';
import { PortfolioStateStore } from './engines/portfolio-state-store.js';

/**
 * Event-driven runtime wiring: Binance public WS -> MarketStateStore,
 * CoinDCX private WS -> PortfolioStateStore. REST stays as the cold-start
 * backfill / recovery path inside the stream implementations themselves.
 */
export interface KernelStreams {
  readonly marketStore: MarketStateStore;
  readonly accountCache: PortfolioStateStore;
  readonly market?: BinanceMarketStream;
  readonly account?: CoinDCXAccountStream;
}

export interface StreamBuildArgs {
  readonly audit: EventStore;
  readonly provider: IMarketDataProvider;
  readonly log: Logger;
  readonly venue: 'paper' | 'coindcx';
  /** Shared runtime store — MUST be the same instance the kernel/TUI reads. */
  readonly marketStore: MarketStateStore;
  readonly accountCache: PortfolioStateStore;
  /** Live CoinDCX client (venue === 'coindcx'); enables the account stream. */
  readonly coindcxClient?: CoinDCXClient;
  /** REST recovery: full broker snapshot for the account cache. */
  readonly resyncAccount?: () => Promise<void>;
}

/** Symbols the kernel WS + pipeline track (shared with the TUI dashboard). */
export const kernelWatchSymbols = (): string[] => {
  const kernelSyms = (process.env.KERNEL_SYMBOLS ?? 'BTCUSDT,SOLUSDT')
    .split(',').map((s) => s.trim().toUpperCase()).filter(Boolean);
  const watchSyms = (process.env.WATCHLIST ?? '')
    .split(',').map((s) => s.trim().toUpperCase()).filter(Boolean);
  return [...new Set([...kernelSyms, ...watchSyms, 'BTCUSDT'])];
};

export const buildStreams = (args: StreamBuildArgs): KernelStreams => {
  const market = process.env.MARKET_STREAM_ENABLED === 'false'
    ? undefined
    : new BinanceMarketStream({ store: args.marketStore, provider: args.provider, audit: args.audit });
  const account = args.coindcxClient && process.env.ACCOUNT_STREAM_ENABLED !== 'false'
    ? new CoinDCXAccountStream({
        client: args.coindcxClient, store: args.accountCache, audit: args.audit,
        resync: args.resyncAccount, log: args.log,
      })
    : undefined;
  return { marketStore: args.marketStore, accountCache: args.accountCache, market, account };
};

/** Boot the event-driven runtime (idempotent). */
export const startStreams = async (streams: KernelStreams, log: Logger): Promise<void> => {
  const symbols = kernelWatchSymbols();
  if (streams.market) {
    await streams.market.subscribe(symbols);
    log.info('market stream started', { symbols });
  } else {
    log.info('market stream disabled; REST-only market data');
  }
  if (streams.account) {
    await streams.account.start();
    log.info('account stream started');
  }
};

export const stopStreams = (streams: KernelStreams): void => {
  streams.market?.stop();
  streams.account?.stop();
};
