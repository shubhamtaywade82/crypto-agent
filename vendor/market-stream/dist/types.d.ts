import type { Candle, Timeframe, BaseEvent } from '@nemesis-oss/market-events';
import type { ExchangeAdapter } from '@nemesis-oss/market-data';
/**
 * The continuously maintained market state for a single symbol+timeframe.
 *
 * This is the primary output of the live intelligence layer. It is updated
 * on every closed candle and is safe for downstream consumers (crypto-agent,
 * dashboards, CLIs) to read at any time.
 *
 * Design principles:
 *  - Immutable per snapshot. Each update produces a new object; the previous
 *    one remains valid for in-flight reads.
 *  - All numeric fields are full-precision strings (Decimal.toString()) so
 *    JSON serialization does not lose precision.
 *  - `activeEvents` contains only events whose `availableAtIndex` falls
 *    within the last `eventLookbackBars` candles of the buffer.
 */
export interface MarketState {
    /** Trading pair. */
    readonly symbol: string;
    /** Timeframe of the working candle buffer. */
    readonly timeframe: Timeframe;
    /** Timestamp of the last closed candle, in ms since epoch. */
    readonly timestamp: number;
    /** Last closed price (full-precision string). */
    readonly price: string;
    /** Candle count in the rolling buffer. */
    readonly candleCount: number;
    /** Trend regime derived from the candle buffer. */
    readonly trendRegime: 'bullish' | 'bearish' | 'range';
    /** Volatility regime derived from ATR displacement. */
    readonly volatilityRegime: 'low' | 'normal' | 'high';
    /** ATR over the lookback window (full-precision string). */
    readonly atr: string;
    /** Active trading session. */
    readonly session: 'asia' | 'london' | 'new_york' | 'off_hours';
    /** Events detected in the rolling window, sorted by availableAtIndex desc. */
    readonly activeEvents: readonly BaseEvent[];
    /** Wall-clock time this snapshot was produced. */
    readonly updatedAt: number;
}
/**
 * A subscription key for the stream orchestrator. Each unique
 * symbol+timeframe pair gets its own WebSocket subscription and its own
 * candle buffer.
 */
export interface StreamKey {
    readonly symbol: string;
    readonly timeframe: Timeframe;
}
/**
 * Configuration for {@link createMarketStream}.
 */
export interface MarketStreamOptions {
    /** Exchange adapter (Binance, Bybit, etc.). */
    readonly adapter: ExchangeAdapter;
    /** Symbol+timeframe pairs to subscribe to. */
    readonly streams: readonly StreamKey[];
    /**
     * Rolling candle buffer depth per stream. Default 200. Must be large
     * enough for event detectors to have lookback context (swings need
     * leftBars+rightBars; structure needs multiple swings).
     */
    readonly candleBufferDepth?: number;
    /**
     * Event detectors to run on each closed candle. Default: all detectors.
     * Set to null to disable event detection (state updates still fire).
     */
    readonly detectors?: readonly DetectableEventType[] | null;
    /**
     * How many candles back to include in `activeEvents`. Default 10.
     * Events older than this are dropped from the state (but remain in
     * the buffer for context).
     */
    readonly eventLookbackBars?: number;
}
/** Re-exported from research-agent types for convenience. */
export type DetectableEventType = 'fvg' | 'bos' | 'choch' | 'mss' | 'order_block' | 'liquidity_sweep' | 'displacement';
/** All available detectors, in canonical order. */
export declare const ALL_DETECTORS: readonly DetectableEventType[];
/** Callback types for stream events. */
export interface MarketStreamCallbacks {
    /** Called on every MarketState update (every closed candle, every stream). */
    readonly onState?: (state: MarketState) => void;
    /** Called on every closed candle, for every stream. */
    readonly onCandle?: (candle: Candle, key: StreamKey) => void;
    /** Called when a new event is detected (fires after onCandle). */
    readonly onEvent?: (event: BaseEvent, key: StreamKey) => void;
    /** Called when a stream's connection status changes. */
    readonly onStatus?: (status: string, key: StreamKey) => void;
    /** Called on unrecoverable stream errors. */
    readonly onError?: (error: Error, key: StreamKey) => void;
}
/**
 * Handle returned by {@link createMarketStream}. Call `stop()` to tear down
 * all subscriptions and release all WebSocket connections.
 */
export interface MarketStream {
    /** Start all subscriptions. Resolves once all streams are connecting. */
    start(): Promise<void>;
    /** Stop all subscriptions and release resources. Idempotent. */
    stop(): Promise<void>;
    /**
     * Get the current MarketState for a symbol+timeframe. Returns null if
     * no candle has been received yet for that stream.
     */
    getState(key: StreamKey): MarketState | null;
    /**
     * Get the rolling candle buffer for a symbol+timeframe. Returns an
     * empty array if the stream has not received any candles yet.
     */
    getCandles(key: StreamKey): readonly Candle[];
    /** Check if a stream is currently active (open). */
    isAlive(key: StreamKey): boolean;
    /** List all stream keys managed by this orchestrator. */
    readonly streams: readonly StreamKey[];
}
//# sourceMappingURL=types.d.ts.map