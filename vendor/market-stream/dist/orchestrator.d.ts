import type { MarketStream, MarketStreamCallbacks, MarketStreamOptions } from './types.js';
/**
 * Multi-symbol, multi-timeframe stream orchestrator.
 *
 * Manages one WebSocket subscription per (symbol, timeframe) pair, each with
 * its own CandleBuffer and StateTracker. New candles from the exchange
 * adapter flow through the StateTracker, which produces a MarketState
 * snapshot and fires the configured callbacks.
 *
 * Backpressure: if a candle arrives while the previous one is still being
 * processed, the new candle is queued via microtask. The adapter's
 * reconnect logic handles transport-level backpressure; this layer handles
 * application-level backpressure by never blocking the event loop — each
 * candle is processed synchronously.
 */
export declare function createMarketStream(options: MarketStreamOptions, callbacks?: MarketStreamCallbacks): MarketStream;
//# sourceMappingURL=orchestrator.d.ts.map