import type { Candle, Timeframe } from '@nemesis-oss/market-events';
import type { ExchangeAdapter, StreamSubscription } from '@nemesis-oss/market-data';

import { CandleBuffer } from './candle-buffer.js';
import { StateTracker } from './state-tracker.js';
import type {
  MarketState,
  MarketStream,
  MarketStreamCallbacks,
  MarketStreamOptions,
  StreamKey,
  DetectableEventType,
} from './types.js';
import { ALL_DETECTORS } from './types.js';

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
export function createMarketStream(
  options: MarketStreamOptions,
  callbacks: MarketStreamCallbacks = {},
): MarketStream {
  const {
    adapter,
    streams,
    candleBufferDepth = 200,
    detectors = ALL_DETECTORS,
    eventLookbackBars = 10,
  } = options;

  // Per-stream state.
  const buffers = new Map<string, CandleBuffer>();
  const trackers = new Map<string, StateTracker>();
  const subscriptions = new Map<string, StreamSubscription>();
  const aliveFlags = new Map<string, boolean>();

  for (const key of streams) {
    const id = keyOf(key);
    buffers.set(id, new CandleBuffer(candleBufferDepth));
    trackers.set(
      id,
      new StateTracker(key.symbol, key.timeframe, buffers.get(id)!, detectors, eventLookbackBars),
    );
    aliveFlags.set(id, false);
  }

  let started = false;
  let stopped = false;

  async function start(): Promise<void> {
    if (started || stopped) return;
    started = true;

    await Promise.all(
      streams.map(async (key) => {
        const id = keyOf(key);
        const tracker = trackers.get(id)!;
        const buffer = buffers.get(id)!;

        try {
          const sub = await adapter.subscribeKlines({
            symbol: key.symbol,
            timeframe: key.timeframe,
            onCandle: (candle: Candle) => {
              const prevState = tracker.current;
              const state = tracker.onCandle(candle);
              if (state) {
                callbacks.onCandle?.(candle, key);
                callbacks.onState?.(state);

                // Fire onEvent for any new events.
                if (callbacks.onEvent) {
                  const prevEvents = new Set(
                    prevState?.activeEvents.map((e) => e.id) ?? [],
                  );
                  for (const ev of state.activeEvents) {
                    if (!prevEvents.has(ev.id)) {
                      callbacks.onEvent(ev, key);
                    }
                  }
                }
              }
            },
            onStatus: (status: string) => {
              callbacks.onStatus?.(status, key);
              aliveFlags.set(id, status === 'open');
            },
            onError: (err: Error) => {
              callbacks.onError?.(err, key);
            },
          });
          subscriptions.set(id, sub);
          aliveFlags.set(id, true);
        } catch (err) {
          callbacks.onError?.(
            err instanceof Error ? err : new Error(String(err)),
            key,
          );
        }
      }),
    );
  }

  async function stop(): Promise<void> {
    if (stopped) return;
    stopped = true;

    await Promise.all(
      Array.from(subscriptions.values()).map((sub) => sub.unsubscribe()),
    );
    subscriptions.clear();
    for (const id of aliveFlags.keys()) {
      aliveFlags.set(id, false);
    }
  }

  function getState(key: StreamKey): MarketState | null {
    return trackers.get(keyOf(key))?.current ?? null;
  }

  function getCandles(key: StreamKey): readonly Candle[] {
    return buffers.get(keyOf(key))?.toArray() ?? [];
  }

  function isAlive(key: StreamKey): boolean {
    return aliveFlags.get(keyOf(key)) ?? false;
  }

  return {
    start,
    stop,
    getState,
    getCandles,
    isAlive,
    streams,
  };
}

/** Stable string key for a StreamKey. */
function keyOf(key: StreamKey): string {
  return `${key.symbol}:${key.timeframe}`;
}
