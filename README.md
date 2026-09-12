# 🤖 Crypto Agent (Gemma 4 31B) 📈

![CI/CD](https://github.com/shubhamtaywade82/crypto-agent/actions/workflows/docker-publish.yml/badge.svg)
![License](https://img.shields.io/badge/license-MIT-blue.svg)
![TypeScript](https://img.shields.io/badge/TypeScript-007ACC?logo=typescript&logoColor=white)
![Hono](https://img.shields.io/badge/Hono-E36002?logo=hono&logoColor=white)

An agentic crypto futures trading system built around a **deterministic trading kernel**.
Gemma 4 (`gemma4:31b` via `@nemesis-oss/ollama-sdk`) is the intelligence layer — it
interprets, ranks and explains — while a hard-gated, fully deterministic pipeline
validates, sizes, authorizes, executes and reconciles every order.

---

## 🏗️ Architecture (canonical — Trading Kernel v3)

```
Binance (market data ONLY)              CoinDCX (execution ONLY)
        │                                       ▲
        ▼                                       │
  MarketState engine ──► Setup engine ──► Policy Gate ──► Execution FSM
        │                     │          (validator +        │
  MTF / regime /          Analyst role      sizer + risk)    ▼
  liquidity / vol         Strategist role        ─── REJECTED / INVALID (terminal)
        │                 Risk Challenger             │
        └─────────── EventStore (decisionId audit ◄──┘ durability contract)
```

Two venues, two strictly separated responsibilities
(see `docs/ADR-001-broker-split.md`):

- **Binance** serves public market data through a provider that *structurally cannot*
  place orders (`IMarketDataProvider` only).
- **CoinDCX** is the execution broker (`IExecutionBroker` only): idempotent orders via
  `client_order_id = decisionId`, TPSL, leverage, INR/USDT routing with a live,
  TTL-bounded USDT/INR FX rate.

### Kernel v3 correctness model

- **Truthful reconciliation** — order lookups return `FOUND | NOT_FOUND | LOOKUP_FAILED`.
  An exchange outage can never be misread as "order missing": `LOOKUP_FAILED` holds
  state; only an affirmative `NOT_FOUND` (with no contradicting position evidence)
  applies the missing-order policy. Orders and positions are reconciled together.
- **FSM audit integrity** — every `order.transition` event records the true
  `from → to` states; critical order events persist under a durability contract
  (durable mode blocks new submissions if the audit backbone degrades).
- **Real portfolio accounting** — all equity is normalized to a canonical USDT basis;
  INR balances convert through a TTL-bounded FX rate (fresh < 30s, stale-usable < 120s,
  otherwise excluded — never mis-added). Daily PnL, loss streak and drawdown come from
  a `PerformanceEngine` fed by realized closes and equity snapshots, persisted across
  restarts.
- **Real instrument specs** — sizing uses actual CoinDCX contract metadata via a safe
  cached `ContractRegistry` (sane-spec gate, bounded stale-while-error). Spec
  unavailability degrades trading (`INSTRUMENT_SPEC_UNAVAILABLE`); it is never papered
  over with synthetic constraints.
- **Global risk reservations** — per-symbol lanes plus a `RiskReservationManager`:
  concurrent symbol pipelines reserve risk after approval, so collective exposure can
  never breach position/gross/cluster caps between approval and fill.
- **Execution-quality contract** — orders carry `expectedPrice` + `maxSlippageBps`;
  market orders become marketable IOC limits at the worst tolerated price, and the
  venue can never fill at an unexpectedly adverse price.
- **Model-authoritative-free levels** — the strategist outputs
  `{action, candidateId, confidence, thesis, invalidation}`; entry/stop/TP are resolved
  server-side from the canonical validated candidate.
- **Cross-venue state** — basis, spreads and execution premium between the reference
  venue and the execution venue are computed first-class
  (`src/domain/market/cross-venue.ts`).
- **Pipeline semantics** — `NO_SETUPS → WAIT → INVALID_PROPOSAL | REJECTED | APPROVED |
  EXECUTED` are distinct, auditable outcomes; structurally invalid proposals never
  masquerade as risk rejections.

### Risk envelope (prop-firm defaults)

0.25% risk/trade · 1% daily stop · 5% max drawdown · 2x max leverage · min RR 2.5 ·
circuit breaker `NORMAL → CAUTION → REDUCED → HALTED → EMERGENCY`.

### Multi-role agent layer

Analyst → Strategist (selects among pre-validated setups by id) → Risk Challenger
(advisory only) — all Zod-validated, fail-closed. The LLM can never mutate levels,
size, or bypass the deterministic `RiskEngine`.

### Kernel tools exposed to the LLM

`get_market_state` · `get_trade_setups` · `propose_trade` (Policy Gate) ·
`execute_approved_intent` · `get_portfolio_state` · `get_risk_status` — plus
`paper_broker_place_order`, risk-gated (SL/TP required; size is computed by the kernel,
never by the model).

### Running the autonomous kernel loop

```bash
cp .env.example .env           # EXECUTION_VENUE=paper by default
npm install
npm run kernel                 # KERNEL_SYMBOLS=BTCUSDT,SOLUSDT, scans every 5 min
```

Kernel API (observability): `GET /api/kernel/state/:symbol`, `GET /api/kernel/portfolio`,
`GET /api/kernel/events`, `GET /api/kernel/orders`, `POST /api/kernel/pipeline/:symbol`.

Docs: `AGENTS.md` (developer & AI agent guide) · `docs/DEPLOYMENT.md` (server & cloud guide) · `docs/REVIEW.md` (e2e scorecard) · `docs/ROADMAP.md` (phases + acceptance criteria) · `docs/ADR-001-broker-split.md` (venue decision record).

---

## 📊 Market Intelligence Layer (vendored)

This repo vendors the full [`market-intelligence`](https://github.com/shubhamtaywade82/market-intelligence) platform under `vendor/`. These packages provide the empirical evidence layer that powers the kernel's market-state, event-scan, and evidence-gate engines.

### Vendored packages

| Package | Path | Purpose |
| :--- | :--- | :--- |
| `@nemesis-oss/market-events` | `vendor/market-events` | Deterministic event detection (FVG, BOS, CHoCH, MSS, OB, sweeps, VSA, Wyckoff) |
| `@nemesis-oss/market-research` | `vendor/market-research` | Empirical validation: matched controls, cluster bootstrap, FDR, walk-forward |
| `@nemesis-oss/market-research-agent` | `vendor/research-agent` | LLM-driven agentic research interface (uses `@nemesis-oss/agentic-runtime`) |
| `@nemesis-oss/market-data` | `vendor/market-data` | Binance/Bybit REST+WS adapters, canonical Candle normalization |
| `@nemesis-oss/market-stream` | `vendor/market-stream` | Live MarketState from WebSocket feeds, multi-stream orchestration |
| `@nemesis-oss/market-state` | `vendor/market-state` | Aggregated cross-symbol view, market breadth, hot symbols |
| `@nemesis-oss/regime-engine` | `vendor/regime-engine` | Composite regime: trend/volatility/liquidity/momentum/derivatives |
| `@nemesis-oss/market-features` | `vendor/market-features` | Deterministic features: returns, ATR, CVD, microstructure |
| `@nemesis-oss/event-graph` | `vendor/event-graph` | Multi-event interaction graph, composite pattern discovery |
| `@nemesis-oss/hypothesis-engine` | `vendor/hypothesis-engine` | LLM proposes → engine tests → WFO → OOS → verdict |
| `@nemesis-oss/strategy-discovery` | `vendor/strategy-discovery` | Candidate generation across events × regimes |
| `@nemesis-oss/strategy-registry` | `vendor/strategy-registry` | Lifecycle: DISCOVERED → … → RETIRED |
| `@nemesis-oss/research-memory` | `vendor/research-memory` | Persistent domain memory, hypothesis deduplication |
| `@nemesis-oss/negative-evidence-system` | `vendor/negative-evidence-system` | Positive vs negative evidence balance per strategy |
| `@nemesis-oss/market-intelligence-api` | `vendor/market-intelligence-api` | HTTP API: /markets /state /events /strategies /research |

### Updating vendored packages

```bash
# After upstream changes in market-intelligence repo:
cp -r ../market-intelligence/packages/<package> vendor/<package>
# Fix workspace:* → file:../ refs in vendor/<package>/package.json
pnpm install
```

See the [market-intelligence ROADMAP](https://github.com/shubhamtaywade82/market-intelligence/blob/main/ROADMAP.md) for the full platform architecture.

---

## ✨ Features

- **ReAct Decision Loop:** Native tool calling with reasoning traces powered by Gemma 4.
- **Deterministic Trading Kernel:** Validator → Sizer → RiskEngine → Reservation →
  Execution FSM → Reconciler, with a decisionId audit trail end to end.
- **Rate-Limit Guardian:** Rolling 60s window tracking (`BinanceRateLimiter`, 1200 weight
  cap, 1000 safe threshold) protecting against Binance 429/418 IP bans.
- **MCP Server Bridge:** Stdio-based Model Context Protocol server (`src/mcp-server.ts`)
  exposing market tools to Claude Desktop and Cursor.
- **Multi-timeframe intelligence:** swings/BOS/CHoCH, liquidity sweeps, volatility
  percentile regimes, 9-state regime classification, weighted 4h→5m alignment.
- **Built-in paper venue:** deterministic in-memory futures simulator (fees, slippage,
  margin, TP/SL triggers, realized-PnL ledger) — no external service required.
- **Streaming SSE & Dashboard:** Real-time token and thought streaming over Server-Sent
  Events, complete with an embedded dark-mode TradingView Lightweight Charts dashboard.
- **Capability-scoped API security:** fail-closed authentication (`KERNEL_API_KEYS`),
  per-key capabilities via `viewer|operator|trader|admin` roles, timing-safe secret
  comparison, and a durable kill switch (pipeline, execution engine and API all honor it).
- **Learning loop foundations:** every executed trade persists a feature snapshot and
  attributes realized outcomes by decisionId; per (setup × regime) cell statistics and
  pre-registered promotion gates decide when a strategy may trade live.
- **Cross-venue execution gate:** CoinDCX order book vs Binance reference (basis/spread
  in bps, staleness health) is checked before risking capital — using REAL Binance
  top-of-book from the book-ticker stream when fresh (source-annotated), with venue
  disagreement beyond tolerance rejecting the trade.
- **Deterministic walk-forward harness with true futures replay:** replays historical
  ladders through the structure/setup engines (no LLM, no network); the simulator models
  real futures constraints (lot rounding, exchange minima, leverage caps, per-side taker
  fees, per-side slippage on fill prices, signed funding, margin utilization, position
  concurrency) so research cells behave like live cells; every (setup × regime) cell is
  evaluated against the SAME frozen promotion gates used for live trading, with a
  chronological **in-sample / out-of-sample split** — a cell promotes only when BOTH
  samples pass, and applying a run persists the approved cells the pipeline then enforces
  (`ACTIVE strategy + approved cell = tradable`).
- **Deterministic slippage enforcement:** every fill delta is checked against
  `expectedPrice ± maxSlippageBps` (marginal fill pricing, exact across average-price
  folds); breaches persist CRITICAL audit events and cancel the un-filled remainder.
- **Position-level attribution:** the fills ledger tracks `positionId → lots → fills →
  decisionId` with FIFO lot closing, netting/flip semantics, `position.opened` /
  `position.closed` audit events, and exactly-once close journaling across restarts.
- **Event-driven market & account runtime:** Binance futures multiplexed WebSocket
  (4-timeframe klines + mark price @1s + mini tickers + book ticker) feeds a deterministic
  `MarketStateStore`; CoinDCX private WS streams (orders, positions, balances) feed a
  `PortfolioStateStore`; the pipeline builds its MTF ladder from the stream when fresh
  with **zero REST calls** and transparently falls back to REST (audited provenance
  `stream|rest`); exponential-backoff reconnects and post-reconnect REST re-seeding keep
  the caches truthful.
- **Dockerized GPU Pipeline:** Multi-stage Alpine container, automatic model catalogue
  verification and pull, NVIDIA GPU passthrough, and persistent model caching.

---

## 🚀 Quickstart

### 1. Docker Compose (Recommended)

Start the entire stack (Ollama + Crypto Agent) with a single command:

```bash
docker compose up --build -d
```

Access the TradingView dashboard and agent chat at `http://localhost:3002`.

### 2. Local Development

Ensure Ollama is running locally on port `11434`:

```bash
# Install dependencies
npm install

# Run test suite (208 tests: unit + property + integration)
npm test

# Run linter and typecheck
npm run lint
npm run typecheck

# Start development server
npm run dev
```

> ⚠️ **Fail-safe boot:** the kill switch boots **HALTED** (and every fresh event store
> boots HALTED). While halted, pipeline runs return `HALTED` and order submission is
> refused. Arm trading once with an admin call — it persists across restarts:
>
> ```bash
> curl -X POST http://localhost:3002/api/kernel/killswitch/resume \
>   -H "Authorization: Bearer boss-1:<admin-secret>" \
>   -H "Content-Type: application/json" \
>   -d '{"reason":"initial arming for paper session"}'
> ```

---

## 📡 API Endpoints

All `/api/*` routes are authenticated (`Authorization: Bearer <keyId>:<secret>` or
`X-Kernel-Key`); with no `KERNEL_API_KEYS` configured they fail closed (401). Probe
routes (`/health`, `/metrics`) remain public for load balancers.

| Endpoint | Method | Capability | Description |
|---|---|---|---|
| `/` | `GET` | — | Embedded TradingView candlestick chart & streaming chat UI |
| `/api/chat` | `POST` | `CREATE_INTENT` | Execute ReAct agent turn (`{ "prompt": "..." }`) |
| `/api/chat/stream` | `GET` | `CREATE_INTENT` | SSE stream for agent thoughts and response tokens |
| `/api/klines` | `GET` | `READ_MARKET` | Lightweight-charts formatted candles (`?symbol=BTCUSDT`) |
| `/api/kernel/state/:symbol` | `GET` | `READ_MARKET` | Canonical multi-timeframe MarketState |
| `/api/kernel/portfolio` | `GET` | `READ_PORTFOLIO` | Live canonical-USDT portfolio state (FX provenance) |
| `/api/kernel/orders` | `GET` | `READ_AUDIT` | Open orders incl. UNKNOWN (reconciler-owned) |
| `/api/kernel/events` | `GET` | `READ_AUDIT` | Recent audit events (`?limit=50`) |
| `/api/kernel/pipeline/:symbol` | `POST` | `RUN_PIPELINE` | Trigger the deterministic pipeline for a symbol |
| `/api/kernel/killswitch` | `GET` | `READ_AUDIT` | Kill-switch state, reason, actor |
| `/api/kernel/analytics` | `GET` | `READ_PORTFOLIO` | Performance summary (Sharpe/Sortino), per-strategy/symbol/regime segments, strategy registry, execution quality (slippage/latency/fills) |
| `/api/kernel/streams` | `GET` | `READ_MARKET` | WS stream health: market/account state, staleness (ms) |
| `/api/kernel/walkforward/:symbol` | `POST` | `ADMIN` | Deterministic walk-forward backtest with futures replay: per-(setup×regime) IS/OOS cell verdicts; body `{"apply": true}` promotes OOS-verified cells into the live registry |
| `/api/kernel/killswitch/halt` | `POST` | `CONTROL_TRADE` | Halt all trading (`{ "reason": "..." }`) |
| `/api/kernel/killswitch/resume` | `POST` | `ADMIN` | Resume trading (reason mandatory, audited) |
| `/metrics` | `GET` | — (public) | Uptime and heap memory statistics |
| `/health` | `GET` | — (public) | Service health status |

### Security configuration

```bash
# id:secret:role[,id:secret:role...] — roles: viewer | operator | trader | admin
KERNEL_API_KEYS="ops-1:s3cret:operator,bot-1:s3cret2:trader,boss-1:s3cret3:admin"
# Cross-venue gate tolerances (bps)
CROSS_VENUE_MAX_BASIS_BPS=50
CROSS_VENUE_MAX_SPREAD_BPS=30
```

---

## 🛡️ Safety Boundaries

1. **Public market data only on Binance** — no Binance private API keys are used.
2. **Execution only via CoinDCX broker** — every order passes the deterministic gate;
   the LLM has no direct order capability.
3. **Fail-closed everywhere** — invalid proposals, unavailable specs, stale FX and
   failed event persistence all stop trading instead of degrading silently.
4. **Unauthenticated access is impossible by design** — no `KERNEL_API_KEYS` means no
   access, never open access; capabilities are per-key, secrets compare timing-safe.
5. **The kill switch is durable and layered** — while HALTED, the pipeline refuses to
   run, the execution engine refuses to submit, and it stays HALTED across restarts
   until an admin resumes with an audited reason.
6. **Learning never bypasses the gates** — strategy promotion requires the pre-registered
   statistical gate to pass; nothing else can move a strategy to ACTIVE.
