# @nemesis-oss/market-stream

> Live market intelligence: continuously maintained `MarketState` from exchange
> WebSocket streams.

## What this package does

`market-stream` is the live counterpart to the historical research layer. It
subscribes to exchange WebSocket feeds, maintains a rolling candle buffer per
symbol/timeframe, runs deterministic event detectors on every closed candle,
and produces a continuously-updated `MarketState` that downstream consumers
(`crypto-agent`, dashboards, CLIs) can read at any time.

Answers **"What is happening to SOLUSDT right now?"** rather than only
**"What historically happened in my dataset?"**

## Architecture

```
Exchange WebSocket (via market-data)
      │
      ▼
  StreamOrchestrator
  ├── per-stream CandleBuffer (rolling ring buffer, dedup by timestamp)
  ├── per-stream StateTracker
  │     ├── extractContextSnapshot (trend, volatility, ATR, session)
  │     └── run event detectors (FVG, BOS, CHoCH, MSS, OB, sweeps, displacement)
  └── callbacks: onState, onCandle, onEvent, onStatus, onError
      │
      ▼
  MarketState { symbol, timeframe, timestamp, price, trendRegime,
                volatilityRegime, atr, session, activeEvents[], updatedAt }
```

## Install

```bash
pnpm install  # from the monorepo root
pnpm --filter @nemesis-oss/market-stream build
```

## Quickstart

```typescript
import { createBinanceAdapter } from '@nemesis-oss/market-data';
import { createMarketStream } from '@nemesis-oss/market-stream';

const stream = createMarketStream(
  {
    adapter: createBinanceAdapter(),
    streams: [
      { symbol: 'BTCUSDT', timeframe: '15m' },
      { symbol: 'ETHUSDT', timeframe: '15m' },
    ],
    candleBufferDepth: 200,      // rolling window per stream
    detectors: ['fvg', 'bos', 'liquidity_sweep'],  // opt-in; null = no detection
    eventLookbackBars: 10,       // events from last 10 candles in activeEvents
  },
  {
    onState: (state) => {
      console.log(`${state.symbol} ${state.timeframe}:`);
      console.log(`  price=${state.price}`);
      console.log(`  trend=${state.trendRegime}, volatility=${state.volatilityRegime}`);
      console.log(`  ATR=${state.atr}, session=${state.session}`);
      console.log(`  activeEvents=${state.activeEvents.length}`);
    },
    onEvent: (event, key) => {
      console.log(`[${key.symbol}] NEW ${event.type} ${event.direction}`);
    },
    onStatus: (status, key) => {
      console.log(`[${key.symbol}] stream: ${status}`);
    },
  },
);

await stream.start();

// Read state on demand:
const btcState = stream.getState({ symbol: 'BTCUSDT', timeframe: '15m' });
console.log(btcState?.price);

// Later:
await stream.stop();
```

## MarketState shape

```typescript
interface MarketState {
  symbol: string;
  timeframe: Timeframe;
  timestamp: number;        // last closed candle timestamp
  price: string;            // full-precision Decimal string
  candleCount: number;      // candles in the rolling buffer
  trendRegime: 'bullish' | 'bearish' | 'range';
  volatilityRegime: 'low' | 'normal' | 'high';
  atr: string;              // full-precision Decimal string
  session: 'asia' | 'london' | 'new_york' | 'off_hours';
  activeEvents: BaseEvent[]; // sorted newest-first
  updatedAt: number;         // wall-clock time this snapshot was produced
}
```

Every snapshot is immutable. Downstream reads are safe at any time.

## Design

- **Zero-lookahead:** the WS subscriber only forwards *closed* candles. The
  in-progress candle is never emitted, matching the deterministic engine's
  causal contract.
- **Rolling ring buffer:** O(1) push, bounded memory. Duplicates are rejected
  by timestamp (reconnect-safe).
- **Configurable detectors:** run all 7 detectors on every candle, or just
  the ones you need (`detectors: ['fvg']`). Set to `null` to disable event
  detection entirely (state updates still fire).
- **Multi-stream:** one orchestrator manages N symbol×timeframe pairs. Each
  has its own buffer and tracker; they update independently.
- **Backpressure-safe:** each candle is processed synchronously. If the
  exchange sends candles faster than the consumer can handle, the buffer
  drops the oldest candle (rolling window), never blocks the event loop.
- **Immutable snapshots:** each update produces a new `MarketState` object;
  the previous one remains valid for in-flight reads.
- **Decimal precision:** all prices/ATR values are `Decimal.toString()` strings
  in the state, so JSON serialization does not lose precision.

## API

See [`src/types.ts`](src/types.ts) for the full `MarketStream` interface.
