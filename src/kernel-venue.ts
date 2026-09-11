import { CoinDCXClient } from '@nemesis-oss/coindcx-sdk';
import { CrossVenueGate } from './infrastructure/coindcx/cross-venue-gate.js';
import { CoinDCXExecutionBroker } from './infrastructure/coindcx/execution-broker.js';
import { ContractRegistry } from './infrastructure/coindcx/contract-registry.js';
import { SymbolRouter } from './infrastructure/coindcx/symbol-router.js';
import { binanceClient } from './config.js';
import { BinanceMarketDataProvider } from './infrastructure/binance/market-data-provider.js';
import type { IExecutionBroker } from './infrastructure/broker/broker.js';
import type { Logger } from './infrastructure/observability/logger.js';
import type { MarketStateStore } from './engines/market-state-store.js';
import { PaperExecutionBroker } from './infrastructure/paper/paper-broker-adapter.js';
import type { PerformanceEngine } from './engines/performance-engine.js';
import type { TradeLedger } from './learning/trade-ledger.js';
import type { PositionCloseAllocation } from './engines/fills-ledger.js';

export type ExecutionVenue = 'paper' | 'coindcx';

export interface VenueStack {
  readonly venue: ExecutionVenue;
  readonly log: Logger;
  readonly performance: PerformanceEngine;
  readonly ledger: TradeLedger;
  readonly marketStore: MarketStateStore;
}

export const recordPaperClose = (
  performance: PerformanceEngine, ledger: TradeLedger,
  c: { decisionId?: string; pnl: number; at: number }
): void => {
  if (!c.decisionId) {
    performance.recordTradeClosed(c.pnl, c.at);
    return;
  }
  const rec = ledger.recordClosed(c.decisionId, c.pnl, c.at);
  performance.recordTradeClosed(c.pnl, c.at, { persist: false });
  if (!rec) performance.recordTradeClosed(c.pnl, c.at);
};

export const recordLiveClose = (
  performance: PerformanceEngine, ledger: TradeLedger, a: PositionCloseAllocation
): void => {
  const rec = ledger.recordClosed(a.decisionId, a.pnl, a.at);
  performance.recordTradeClosed(a.pnl, a.at, { persist: false });
  if (!rec) performance.recordTradeClosed(a.pnl, a.at);
};

export const buildBroker = (
  parts: VenueStack
): {
  client?: CoinDCXClient;
  broker: IExecutionBroker;
  router?: SymbolRouter;
  registry?: ContractRegistry;
  crossVenueGate?: (symbol: string) => Promise<{ readonly tradable: boolean; readonly reasons: readonly string[] }>;
} => {
  const { venue, log, performance, ledger, marketStore } = parts;
  if (venue === 'coindcx') return buildCoinDCXStack(log, marketStore);
  log.info('execution venue: paper');
  return {
    broker: new PaperExecutionBroker({
      initialBalance: Number(process.env.PAPER_INITIAL_FUTURES_BALANCE ?? 10_000),
      onClose: (c): void => recordPaperClose(performance, ledger, c),
    }),
  };
};

export interface CoinDCXStack {
  readonly client: CoinDCXClient;
  readonly broker: IExecutionBroker;
  readonly router: SymbolRouter;
  readonly registry: ContractRegistry;
  readonly crossVenueGate: (
    symbol: string
  ) => Promise<{ readonly tradable: boolean; readonly reasons: readonly string[] }>;
}

/** Live cross-venue gate: CoinDCX book vs Binance reference, env-tuned. */
const buildCrossVenueGate = (
  client: CoinDCXClient,
  router: SymbolRouter,
  marketStore?: MarketStateStore
): CrossVenueGate =>
  new CrossVenueGate(
    {
      client,
      router,
      binanceTicker: (symbol: string): Promise<number> =>
        new BinanceMarketDataProvider(binanceClient).getTickerPrice(symbol),
      // REAL Binance top-of-book from the WS book-ticker stream when the
      // store carries a fresh quote; the gate falls back to the last-price
      // proxy only when the book quote is missing/stale (annotated).
      binanceQuote: (symbol: string): { readonly bid: number; readonly ask: number; readonly at: number } | undefined => {
        const snap = marketStore?.snapshot(symbol);
        if (!snap || snap.bestBid === undefined || snap.bestAsk === undefined) return undefined;
        return { bid: snap.bestBid, ask: snap.bestAsk, at: snap.bestQuoteAt ?? snap.updatedAt };
      },
    },
    {
      maxBasisBps: Number(process.env.CROSS_VENUE_MAX_BASIS_BPS ?? 50),
      maxSpreadBps: Number(process.env.CROSS_VENUE_MAX_SPREAD_BPS ?? 30),
    }
  );

/** Live CoinDCX execution stack: broker + routing + contracts + gate. */
export const buildCoinDCXStack = (log: Logger, marketStore?: MarketStateStore): CoinDCXStack => {
  const client = new CoinDCXClient({
    apiKey: process.env.COINDCX_API_KEY,
    apiSecret: process.env.COINDCX_API_SECRET,
  });
  const router = new SymbolRouter(
    client,
    (process.env.COINDCX_QUOTE_PREFERENCE as 'USDT' | 'INR' | 'auto') ?? 'auto'
  );
  const registry = new ContractRegistry({
    ttlMs: Number(process.env.CONTRACT_TTL_MS ?? 5 * 60_000),
    maxStaleMs: Number(process.env.CONTRACT_MAX_STALE_MS ?? 30 * 60_000),
  });
  const crossVenue = buildCrossVenueGate(client, router, marketStore);
  log.info('execution venue: coindcx');
  return {
    client,
    broker: new CoinDCXExecutionBroker(client, {
      maxOrderNotional: Number(process.env.MAX_POSITION_NOTIONAL_USDT ?? 5000),
      fxProvider: (): Promise<number> => router.usdtInr(),
    }),
    router,
    registry,
    crossVenueGate: (symbol: string): Promise<{ readonly tradable: boolean; readonly reasons: readonly string[] }> =>
      crossVenue.evaluate(symbol),
  };
};
