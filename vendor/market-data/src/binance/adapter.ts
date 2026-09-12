import type { Candle } from '@nemesis-oss/market-events';

import type {
  ExchangeAdapter,
  ExchangeId,
  FetchKlinesOptions,
  FundingRateSnapshot,
  LiveKlineSubscription,
  MarkPriceSnapshot,
  OpenInterestSnapshot,
  StreamSubscription,
} from '../types.js';
import type { BinanceAdapterConfig } from './rest.js';
import {
  BINANCE_REST_FUTURES,
  BINANCE_REST_SPOT,
  BINANCE_WS_FUTURES,
  BinanceRestAdapter,
} from './rest.js';
import { subscribeBinanceKlines, type BinanceWsConfig } from './ws.js';

/**
 * Binance adapter: implements the full {@link ExchangeAdapter} surface
 * using spot REST for klines and USDⓈ-M futures REST for funding/OI/mark.
 *
 * Live klines come from the futures WebSocket stream, which sends a
 * kline message on every update but only closed klines are forwarded to
 * the consumer.
 */
export class BinanceAdapter implements ExchangeAdapter {
  readonly exchange: ExchangeId = 'binance';
  readonly restBaseUrl: string;
  readonly wsBaseUrl: string;

  private readonly rest: BinanceRestAdapter;
  private readonly wsConfig: BinanceWsConfig;

  constructor(config: BinanceAdapterConfig & BinanceWsConfig = {}) {
    const spotRest = config.spotRestBaseUrl ?? BINANCE_REST_SPOT;
    this.restBaseUrl = spotRest;
    this.wsBaseUrl = config.wsBaseUrl ?? BINANCE_WS_FUTURES;
    this.rest = new BinanceRestAdapter({
      spotRestBaseUrl: spotRest,
      futuresRestBaseUrl: config.futuresRestBaseUrl ?? BINANCE_REST_FUTURES,
      requestTimeoutMs: config.requestTimeoutMs,
      maxRetries: config.maxRetries,
      retryBackoffMs: config.retryBackoffMs,
    });
    this.wsConfig = {
      wsBaseUrl: this.wsBaseUrl,
      reconnectBackoffMs: config.reconnectBackoffMs,
      maxReconnectBackoffMs: config.maxReconnectBackoffMs,
      maxReconnectAttempts: config.maxReconnectAttempts,
      pingIntervalMs: config.pingIntervalMs,
    };
  }

  fetchKlines(options: FetchKlinesOptions): Promise<readonly Candle[]> {
    return this.rest.fetchKlines(options);
  }

  subscribeKlines(sub: LiveKlineSubscription): Promise<StreamSubscription> {
    return subscribeBinanceKlines(sub, this.wsConfig);
  }

  fetchFundingRate(symbol: string): Promise<FundingRateSnapshot | null> {
    return this.rest.fetchFundingRate(symbol);
  }

  fetchOpenInterest(symbol: string): Promise<OpenInterestSnapshot | null> {
    return this.rest.fetchOpenInterest(symbol);
  }

  fetchMarkPrice(symbol: string): Promise<MarkPriceSnapshot | null> {
    return this.rest.fetchMarkPrice(symbol);
  }
}

/** Factory: create a Binance adapter with sensible defaults. */
export function createBinanceAdapter(
  config?: BinanceAdapterConfig & BinanceWsConfig,
): BinanceAdapter {
  return new BinanceAdapter(config);
}
