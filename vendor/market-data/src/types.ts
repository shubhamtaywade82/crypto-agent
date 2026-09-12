import type { Candle, Timeframe } from '@nemesis-oss/market-events';

/**
 * Canonical exchange identifier. Used for provenance and routing.
 */
export type ExchangeId = 'binance' | 'bybit';

/**
 * Mapping from canonical {@link Timeframe} to exchange-native interval
 * strings. Each exchange adapter owns its own mapping; this is the shared
 * contract.
 */
export type IntervalMap = Readonly<Record<Timeframe, string>>;

/**
 * Options for fetching historical klines.
 */
export interface FetchKlinesOptions {
  /** Trading pair, exchange-native format (e.g. "ETHUSDT" on Binance). */
  readonly symbol: string;
  /** Canonical timeframe. */
  readonly timeframe: Timeframe;
  /** Inclusive start, in ms since epoch. */
  readonly startTime: number;
  /** Exclusive end, in ms since epoch. */
  readonly endTime: number;
  /** Max candles per HTTP batch. Default exchange-specific. */
  readonly batchLimit?: number | undefined;
  /** Optional abort signal for cancellation. */
  readonly signal?: AbortSignal | undefined;
}

/**
 * Options for subscribing to a live kline stream.
 */
export interface LiveKlineSubscription {
  readonly symbol: string;
  readonly timeframe: Timeframe;
  /** Called once per closed candle. Never called for the in-progress candle. */
  readonly onCandle: (candle: Candle) => void;
  /** Called when the connection state changes. */
  readonly onStatus?: (status: StreamStatus) => void;
  /** Called on unrecoverable errors. */
  readonly onError?: (err: Error) => void;
}

export type StreamStatus =
  | 'connecting'
  | 'open'
  | 'reconnecting'
  | 'closed'
  | 'error';

/**
 * Handle returned by {@link ExchangeAdapter.subscribeKlines}. Call
 * `unsubscribe()` to tear down the underlying WebSocket and free resources.
 */
export interface StreamSubscription {
  /** Stop the stream and release the socket. Idempotent. */
  unsubscribe(): Promise<void>;
  /** Current connection state. */
  readonly status: StreamStatus;
}

/**
 * Funding rate snapshot for a single symbol at a point in time.
 */
export interface FundingRateSnapshot {
  readonly symbol: string;
  readonly fundingRate: number;
  readonly fundingTime: number;
  readonly markPrice: number;
}

/**
 * Open-interest snapshot for a single symbol.
 */
export interface OpenInterestSnapshot {
  readonly symbol: string;
  readonly openInterest: number;
  readonly openInterestAsset?: string;
  readonly timestamp: number;
}

/**
 * Mark-price snapshot (used for fair-value funding and liquidation logic).
 */
export interface MarkPriceSnapshot {
  readonly symbol: string;
  readonly markPrice: number;
  readonly indexPrice: number;
  readonly fundingRate: number;
  readonly timestamp: number;
}

/**
 * The exchange adapter contract. Concrete adapters (Binance, Bybit) implement
 * this surface. Adapters are responsible for:
 *
 *  - translating canonical {@link Timeframe} → exchange-native interval,
 *  - rate-limit-aware pagination over historical windows,
 *  - normalization of raw responses to {@link Candle} (Decimal-typed),
 *  - WebSocket lifecycle (connect, reconnect, recover),
 *  - timestamp normalization to UTC ms since epoch.
 *
 * Adapters are NOT responsible for:
 *  - event detection (that is `market-events`),
 *  - empirical research (that is `market-research`),
 *  - agentic orchestration (that is `research-agent`).
 *
 * The adapter is the bottom of the dependency stack: it depends only on
 * `market-events` for the canonical `Candle` type.
 */
export interface ExchangeAdapter {
  /** Exchange identifier. */
  readonly exchange: ExchangeId;
  /** REST base URL (overridable for testing/regional endpoints). */
  readonly restBaseUrl: string;
  /** WebSocket base URL. */
  readonly wsBaseUrl: string;

  /**
   * Fetch historical klines (closed candles only) for a time range.
   * Paginates automatically to respect exchange rate limits. Returns candles
   * sorted ascending by timestamp, deduplicated.
   */
  fetchKlines(options: FetchKlinesOptions): Promise<readonly Candle[]>;

  /**
   * Subscribe to a live kline stream. The callback fires once per *closed*
   * candle — never for the in-progress candle. Returns a handle to
   * unsubscribe and inspect connection state.
   */
  subscribeKlines(sub: LiveKlineSubscription): Promise<StreamSubscription>;

  /**
   * Fetch the most recent funding rate snapshot for a symbol.
   * Returns null if the exchange does not support funding for this symbol.
   */
  fetchFundingRate(symbol: string): Promise<FundingRateSnapshot | null>;

  /**
   * Fetch the current open-interest snapshot for a symbol.
   * Returns null if the exchange does not support OI for this symbol.
   */
  fetchOpenInterest(symbol: string): Promise<OpenInterestSnapshot | null>;

  /**
   * Fetch the current mark-price snapshot for a symbol.
   * Returns null if the exchange does not support mark price for this symbol.
   */
  fetchMarkPrice(symbol: string): Promise<MarkPriceSnapshot | null>;
}

/**
 * Adapter construction options.
 */
export interface ExchangeAdapterOptions {
  /** Override REST base URL (testing, regional endpoints). */
  readonly restBaseUrl?: string;
  /** Override WebSocket base URL. */
  readonly wsBaseUrl?: string;
  /** Per-request timeout, ms. Default 15_000. */
  readonly requestTimeoutMs?: number;
  /** Max retries on transient transport errors. Default 3. */
  readonly maxRetries?: number;
  /** Initial backoff for retries, ms. Default 500. */
  readonly retryBackoffMs?: number;
}
