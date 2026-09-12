# @nemesis-oss/market-data

> Exchange data adapters: historical klines, live WebSocket streams, and
> normalization to canonical `Candle` types.

## What this package does

`market-data` is the bottom of the dependency stack. It fetches OHLCV data
from exchanges and normalizes it to the `Candle` type defined in
`@nemesis-oss/market-events` (Decimal-typed, ms-timestamped). The deterministic
engines and the agentic layer never need to know which exchange the data came
from.

## Architecture

```
Binance REST  ─┐
Binance WS    ─┤
Bybit REST    ─┤─→ ExchangeAdapter ─→ canonical Candle[]
CoinDCX (TBD) ─┤
              ─┘
                  ↓
          market-events / market-research / research-agent
```

## Install

```bash
pnpm install  # from the monorepo root
pnpm --filter @nemesis-oss/market-data build
```

## Quickstart

### Historical klines

```typescript
import { createBinanceAdapter } from '@nemesis-oss/market-data';

const binance = createBinanceAdapter();
const candles = await binance.fetchKlines({
  symbol: 'BTCUSDT',
  timeframe: '15m',
  startTime: Date.now() - 24 * 60 * 60 * 1000,  // 24h ago
  endTime: Date.now(),
});

console.log(candles.length);          // ~96 candles (4 per hour × 24h)
console.log(candles[0].open.toString());  // full-precision Decimal string
```

### Live kline stream

```typescript
import { createBinanceAdapter } from '@nemesis-oss/market-data';

const binance = createBinanceAdapter();
const stream = await binance.subscribeKlines({
  symbol: 'BTCUSDT',
  timeframe: '15m',
  onCandle: (candle) => {
    // Fires once per CLOSED candle — never for the in-progress candle.
    // This matches the deterministic engine's zero-lookahead contract.
    console.log(`${candle.timestamp}: close=${candle.close.toString()}`);
  },
  onStatus: (status) => console.log('stream:', status),
  onError: (err) => console.error('stream error:', err),
});

// Later:
await stream.unsubscribe();
```

### Funding, open interest, mark price

```typescript
const funding = await binance.fetchFundingRate('BTCUSDT');
const oi = await binance.fetchOpenInterest('BTCUSDT');
const mark = await binance.fetchMarkPrice('BTCUSDT');
```

### Direct to research agent

```typescript
import { createBinanceAdapter } from '@nemesis-oss/market-data';
import { createResearchAgentFromExchange } from '@nemesis-oss/market-research-agent';

const agent = await createResearchAgentFromExchange({
  adapter: createBinanceAdapter(),
  symbol: 'BTCUSDT',
  timeframe: '15m',
  startTime: Date.now() - 30 * 24 * 60 * 60 * 1000,
  endTime: Date.now(),
  htfTimeframes: ['1h', '4h'],
});

const result = await agent.research(
  'Does bullish FVG continuation on BTCUSDT 15m provide statistically significant 2R edge?',
);
```

## Exchanges

| Exchange | REST klines | WS klines | Funding | Open Interest | Mark Price |
| :--- | :---: | :---: | :---: | :---: | :---: |
| Binance | ✅ | ✅ | ✅ | ✅ | ✅ |
| Bybit | ✅ | ⬜ (TBD) | ✅ | ✅ | ✅ |
| CoinDCX | ⬜ (TBD) | ⬜ (TBD) | — | — | — |

## Design

- **Decimal precision:** all prices/volumes are `Decimal` instances, never
  `number`. Avoids floating-point loss across the deterministic engines.
- **Rate-limit aware:** pagination with `batchLimit ≤ 1000`. HTTP 429
  triggers exponential backoff honoring `Retry-After`.
- **Zero-lookahead streams:** the WebSocket subscriber only forwards *closed*
  candles. The in-progress candle is never emitted, matching the deterministic
  engine's causal contract.
- **Reconnect/recovery:** exponential backoff (1s → 30s cap), configurable
  max attempts. Connection state surfaced via `onStatus` callback.
- **No external HTTP client:** uses Node 20+ global `fetch`. The only runtime
  dependency is `ws` for WebSocket support.

## API

See [`src/types.ts`](src/types.ts) for the full `ExchangeAdapter` interface.
