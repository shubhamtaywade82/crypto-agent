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

# Run test suite (163 tests: unit + property + integration)
npm test

# Run linter and typecheck
npm run lint
npm run typecheck

# Start development server
npm run dev
```

---

## 📡 API Endpoints

| Endpoint | Method | Description |
|---|---|---|
| `/` | `GET` | Embedded TradingView candlestick chart & streaming chat UI |
| `/api/chat` | `POST` | Execute ReAct agent turn (`{ "prompt": "..." }`) |
| `/api/chat/stream` | `GET` | SSE stream for real-time agent thoughts and response tokens (`?prompt=...`) |
| `/api/klines` | `GET` | Lightweight-charts formatted candlestick data (`?symbol=BTCUSDT`) |
| `/api/kernel/portfolio` | `GET` | Live canonical-USDT portfolio state (FX provenance included) |
| `/metrics` | `GET` | Uptime and heap memory statistics |
| `/health` | `GET` | Service health status |

---

## 🛡️ Safety Boundaries

1. **Public market data only on Binance** — no Binance private API keys are used.
2. **Execution only via CoinDCX broker** — every order passes the deterministic gate;
   the LLM has no direct order capability.
3. **Fail-closed everywhere** — invalid proposals, unavailable specs, stale FX and
   failed event persistence all stop trading instead of degrading silently.
