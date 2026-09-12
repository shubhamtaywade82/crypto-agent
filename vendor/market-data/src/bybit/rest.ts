import { Decimal } from 'decimal.js';
import type { Candle, Timeframe } from '@nemesis-oss/market-events';

import type {
  ExchangeId,
  FetchKlinesOptions,
  FundingRateSnapshot,
  MarkPriceSnapshot,
  OpenInterestSnapshot,
} from '../types.js';
import { httpGetJson } from '../http.js';

export const BYBIT_REST_V5 = 'https://api.bybit.com';
export const BYBIT_WS_PUBLIC = 'wss://stream.bybit.com/v5/public/linear';

export const BYBIT_INTERVAL_MAP: Readonly<Record<Timeframe, string>> = {
  '1m': '1',
  '3m': '3',
  '5m': '5',
  '15m': '15',
  '30m': '30',
  '1h': '60',
  '2h': '120',
  '4h': '240',
  '6h': '360',
  '8h': '480',
  '12h': '720',
  '1d': 'D',
  '1w': 'W',
  '1M': 'M',
};

interface BybitKlineResponse {
  retCode: number;
  retMsg: string;
  result: {
    category: string;
    symbol: string;
    list: ReadonlyArray<
      readonly [string, string, string, string, string, string, string]
    >;
  };
  time: number;
}

interface BybitTickersResponse {
  retCode: number;
  retMsg: string;
  result: {
    list: ReadonlyArray<{
      symbol: string;
      fundingRate?: string;
      markPrice?: string;
      indexPrice?: string;
      openInterest?: string;
      nextFundingTime?: string;
    }>;
  };
}

export interface BybitAdapterConfig {
  readonly restBaseUrl?: string;
  readonly requestTimeoutMs?: number;
  readonly maxRetries?: number;
  readonly retryBackoffMs?: number;
}

/**
 * Bybit V5 REST adapter. Implements historical klines, funding, OI, and
 * mark-price surface for linear (USDT-perp) instruments.
 *
 * Note: this is a thinner implementation than the Binance adapter — Bybit's
 * WebSocket requires a more involved topic-subscription protocol and is
 * intentionally deferred to a follow-up. REST klines cover the primary
 * research use case (historical dataset construction).
 */
export class BybitRestAdapter {
  readonly exchange: ExchangeId = 'bybit';
  readonly restBaseUrl: string;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly retryBackoffMs: number;

  constructor(config: BybitAdapterConfig = {}) {
    this.restBaseUrl = config.restBaseUrl ?? BYBIT_REST_V5;
    this.timeoutMs = config.requestTimeoutMs ?? 15_000;
    this.maxRetries = config.maxRetries ?? 3;
    this.retryBackoffMs = config.retryBackoffMs ?? 500;
  }

  async fetchKlines(
    options: FetchKlinesOptions,
  ): Promise<readonly Candle[]> {
    const interval = BYBIT_INTERVAL_MAP[options.timeframe];
    const batchLimit = Math.min(options.batchLimit ?? 1000, 1000);
    const all: Candle[] = [];
    const seen = new Set<number>();
    let currentStart = Math.floor(options.startTime / 1000);

    while (currentStart * 1000 < options.endTime) {
      const url = new URL(`${this.restBaseUrl}/v5/market/kline`);
      url.searchParams.set('category', 'linear');
      url.searchParams.set('symbol', options.symbol);
      url.searchParams.set('interval', interval);
      url.searchParams.set('start', String(currentStart));
      url.searchParams.set('limit', String(batchLimit));

      const data = await httpGetJson<BybitKlineResponse>({
        url: url.toString(),
        timeoutMs: this.timeoutMs,
        maxRetries: this.maxRetries,
        retryBackoffMs: this.retryBackoffMs,
        signal: options.signal,
      });

      if (data.retCode !== 0) {
        throw new Error(
          `Bybit kline error: ${data.retCode} ${data.retMsg}`,
        );
      }

      const list = data.result.list ?? [];
      if (list.length === 0) break;

      // Bybit returns klines newest-first; we accumulate oldest-first.
      for (const raw of list) {
        const ts = Number(raw[0]);
        if (seen.has(ts)) continue;
        seen.add(ts);
        all.push({
          timestamp: ts,
          open: new Decimal(raw[1]),
          high: new Decimal(raw[2]),
          low: new Decimal(raw[3]),
          close: new Decimal(raw[4]),
          volume: new Decimal(raw[5]),
        });
      }

      const oldestTs = Number(list[list.length - 1]![0]);
      const newestTs = Number(list[0]![0]);
      if (newestTs <= currentStart * 1000) break;
      currentStart = Math.floor(oldestTs / 1000) + 1;

      if (list.length < batchLimit) break;
    }

    all.sort((a, b) => a.timestamp - b.timestamp);
    return all;
  }

  async fetchFundingRate(symbol: string): Promise<FundingRateSnapshot | null> {
    const url = new URL(`${this.restBaseUrl}/v5/market/tickers`);
    url.searchParams.set('category', 'linear');
    url.searchParams.set('symbol', symbol);
    const data = await httpGetJson<BybitTickersResponse>({
      url: url.toString(),
      timeoutMs: this.timeoutMs,
      maxRetries: this.maxRetries,
      retryBackoffMs: this.retryBackoffMs,
    });
    if (data.retCode !== 0 || data.result.list.length === 0) return null;
    const t = data.result.list[0]!;
    if (!t.fundingRate) return null;
    return {
      symbol,
      fundingRate: Number(t.fundingRate),
      markPrice: Number(t.markPrice ?? '0'),
      fundingTime: Number(t.nextFundingTime ?? '0'),
    };
  }

  async fetchOpenInterest(
    symbol: string,
  ): Promise<OpenInterestSnapshot | null> {
    const url = new URL(`${this.restBaseUrl}/v5/market/tickers`);
    url.searchParams.set('category', 'linear');
    url.searchParams.set('symbol', symbol);
    const data = await httpGetJson<BybitTickersResponse>({
      url: url.toString(),
      timeoutMs: this.timeoutMs,
      maxRetries: this.maxRetries,
      retryBackoffMs: this.retryBackoffMs,
    });
    if (data.retCode !== 0 || data.result.list.length === 0) return null;
    const t = data.result.list[0]!;
    if (!t.openInterest) return null;
    return {
      symbol,
      openInterest: Number(t.openInterest),
      timestamp: Date.now(),
    };
  }

  async fetchMarkPrice(symbol: string): Promise<MarkPriceSnapshot | null> {
    const url = new URL(`${this.restBaseUrl}/v5/market/tickers`);
    url.searchParams.set('category', 'linear');
    url.searchParams.set('symbol', symbol);
    const data = await httpGetJson<BybitTickersResponse>({
      url: url.toString(),
      timeoutMs: this.timeoutMs,
      maxRetries: this.maxRetries,
      retryBackoffMs: this.retryBackoffMs,
    });
    if (data.retCode !== 0 || data.result.list.length === 0) return null;
    const t = data.result.list[0]!;
    if (!t.markPrice) return null;
    return {
      symbol,
      markPrice: Number(t.markPrice),
      indexPrice: Number(t.indexPrice ?? '0'),
      fundingRate: Number(t.fundingRate ?? '0'),
      timestamp: Date.now(),
    };
  }
}

/** Factory: create a Bybit adapter. */
export function createBybitRestAdapter(
  config?: BybitAdapterConfig,
): BybitRestAdapter {
  return new BybitRestAdapter(config);
}
