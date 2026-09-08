# ROADMAP — crypto-agent 9+

Phased plan with acceptance criteria. Phases 1–4 are implemented on
`feat/coindcx-execution`; kernel v3 correctness lands on
`feat/trading-kernel-v3`; phases 5–6 remain open work.

## Phase 1 — Trading kernel ✅ (this branch)

- [x] Futures domain model (ContractSpec, PositionView, liquidation math)
- [x] Canonical MarketState (4 TF ladder, structure/momentum/volatility/liquidity/futures)
- [x] PortfolioState + exposure/cluster aggregation
- [x] OrderState FSM incl. UNKNOWN + illegal-transition guards
- [x] RiskEngine (final authority, 9 checks, circuit breaker NORMAL→EMERGENCY)
- [x] TradeValidator (SL/TP geometry + min R:R hard invariant)
- [x] Position sizing pipeline (fees, slippage, funding, lot step, min notional, caps)
- [x] Prop-firm risk envelope defaults + env overrides

**Acceptance:** for any proposal, `riskAmount ≤ equity × maxRiskPerTradePercent × circuitMultiplier`
holds for all generated inputs (property-tested); `SL < entry < TP` geometry enforced by type
and validator; no code path from LLM output to order without RiskEngine approval.

## Phase 2 — Execution ✅ (this branch, live soak pending)

- [x] Order state machine runtime (ExecutionEngine) with submit-timeout → UNKNOWN
- [x] Broker abstraction with explicit capabilities (`IExecutionBroker`, `IMarketDataProvider`)
- [x] Binance market-data-only provider (execution structurally impossible)
- [x] CoinDCX futures adapter (idempotent client_order_id, TPSL, leverage, margin type)
- [x] SymbolRouter: USDT-margined preferred, INR fallback + live USDTINR FX
- [x] Reconciler (query-by-client_order_id → fold broker truth → repair)
- [x] Paper venue with fees/slippage/TP-SL/liquidation-margin simulation
- [x] Live fills ledger: every fill delta (submit path AND reconciler fold)
      persists a `fill.recorded` event (delta + cumulative quantity = replay-safe);
      execution-quality metrics (signed slippage bps vs the decision's expected
      price, fill latency) served via `/api/kernel/analytics`; on the LIVE venue,
      EXIT/REDUCE fills realize position PnL against the average entry and
      attribute the close to the ENTRY decision's feature snapshot (paper venue
      keeps its own onClose ledger - no double counting)
- [x] Event-driven runtime (this branch): Binance futures multiplexed WS
      (`kline_5m/15m/1h/4h + markPrice@1s + miniTicker`) → `MarketStateStore`,
      CoinDCX private WS (`df-order-update`, `df-position-update`, `balance-update`)
      → `PortfolioStateStore`; REST demoted to cold-start backfill / reconnect
      gap-recovery; pipeline serves MTF from the store when fresh (zero REST)
      and falls back to REST otherwise; provenance (`stream|rest`) audited on
      every `pipeline.snapshot`; exponential backoff + jitter reconnect with
      `maxRetries` give-up (REST serves while DOWN); account cache re-seeds from
      a full REST snapshot on EVERY reconnect before it is trusted again
- [ ] CoinDCX sandbox contract tests + recorded fixtures
- [ ] 72h paper soak with reconciliation report deltas = 0

**Acceptance:** kill -9 mid-submit → restart → reconciler converges internal state to broker
state within one interval; duplicate submit with same decisionId cannot double-fill.

## Phase 2.5 — Kernel v3 correctness ✅ (branch `feat/trading-kernel-v3`)

Closes the highest-risk correctness gaps found in the v2 review: runtime state
integrity, portfolio accounting, execution reconciliation truth, and concurrency.

- [x] FSM audit integrity: `order.transition` events record the true `from → to`
      (old state captured before mutation, never `from === to`)
- [x] Truthful broker lookups: `BrokerLookupResult = FOUND | NOT_FOUND | LOOKUP_FAILED`;
      `LOOKUP_FAILED` (outage/auth/rate-limit) holds state instead of cancelling —
      the old `undefined`-conflation could cancel live orders during an exchange outage
- [x] Order+position reconciliation: reconciler snapshots positions each cycle; a
      confirmed fill with live position evidence advances to `POSITION_OPEN`; a
      `NOT_FOUND` with contradicting position evidence is held for review
- [x] Canonical portfolio valuation: INR/USDT normalized to a USDT basis through a
      TTL-bounded FX rate (fresh < 30s, stale-usable < 120s, else excluded — never
      mis-added); valuation provenance (fxRate, freshness, exclusions) on every snapshot
- [x] Real portfolio metrics: `PerformanceEngine` measures daily realized PnL, loss
      streak, drawdown (equity high-water mark), win/loss stats from realized closes;
      persisted via the event store and hydrated on restart (no more `() => 0` zeros)
- [x] Paper venue emits realized closes (`onClose` ledger) feeding the performance engine
- [x] Real instrument specs in sizing: `ContractRegistry` with sane-spec gate, TTL cache,
      bounded stale-while-error; spec unavailability rejects with
      `INSTRUMENT_SPEC_UNAVAILABLE` (trading degraded) instead of synthetic fallback specs
- [x] Global risk reservations: `RiskReservationManager` gates concurrent symbol lanes
      against projected position/symbol/cluster/gross limits; commit-on-fill,
      release-on-fail, TTL expiry for orders stuck in UNKNOWN
- [x] Pipeline statuses: structurally invalid proposals surface as `INVALID_PROPOSAL`
      (with `proposal.invalid` audit events), distinct from `REJECTED`
- [x] Min-notional rounding: `ceil` to lot step (floor could land below the minimum),
      followed by the risk-budget tolerance check
- [x] CoinDCX FX TTL cache with fresh/stale/expired policy — refuses to price INR orders
      on an expired rate instead of using a possibly ancient cached value
- [x] Execution-quality contract: `expectedPrice` + `maxSlippageBps` on
      `PlaceOrderRequest`; CoinDCX converts guarded market orders to marketable IOC
      limits, paper venue rejects breaches; requests carry strategy/decision lineage
- [x] Event store durability contract: critical order events (`order.*`, `reconcile`)
      must persist in durable (live) mode — write failures mark the store unhealthy and
      block new submissions
- [x] Strategist contract tightened to `{action, candidateId, confidence, thesis,
      invalidation}`; levels resolved server-side from the canonical candidate
- [x] `CrossVenueState` domain (basis, spread bps, execution premium, staleness health)
      ready for runtime wiring
- [x] Restart truth: `ExecutionEngine.hydrate()` rebuilds tracked orders (including
      UNKNOWN and SUBMITTING) from the event log at boot — a kill -9 mid-submit no
      longer forgets a live order; the reconciler converges it instead. Duplicate
      submits of the same decisionId are refused (no double venue order)
- [x] Pipeline refreshes live portfolio state every run (no more trading on stale/zero
      fallback equity)
- [x] `CrossVenueState` wired into the live pipeline gate: `CrossVenueGate` reads the
      CoinDCX futures order book vs the Binance reference ticker (INR pairs normalized
      through the routed FX rate) and rejects execution when basis/spread/health exceed
      env-tuned tolerances (`CROSS_VENUE_MAX_BASIS_BPS`, `CROSS_VENUE_MAX_SPREAD_BPS`);
      snapshot failures fail safe (no new risk)
- [ ] CoinDCX fills ledger → realized PnL for the LIVE venue (paper is complete)
- [ ] Private WS streams to drive the FSM push-based (see Phase 2 open items)

**Acceptance:** concurrent same-moment approvals on two symbols cannot exceed
`maxConcurrentPositions` or gross exposure caps (tested); a CoinDCX outage during
reconciliation leaves every tracked order in its pre-outage state (tested); equity of
`10,000 INR + 1,000 USDT` is never 11,000 (tested); every audit event is a genuine
`from → to` transition (tested).

## Phase 3 — Intelligence ✅ (this branch)

- [x] Indicators: Wilder RSI, MACD, ATR, EMA, percentile
- [x] Structure engine: swings, BOS, CHoCH, trend
- [x] Liquidity engine: nearest levels, sweep detection (buy-side/sell-side)
- [x] Volatility engine: ATR%, percentile, LOW/NORMAL/EXPANSION/HIGH regimes
- [x] Regime engine: 9-state classification + BTC macro filter
- [x] MTF engine: 4h→1h→15m→5m weighted alignment
- [x] Setup engine: 4 detectors → pre-validated ranked candidates (max 3)
- [ ] FVG / order-block / premium-discount detection
- [ ] OI+funding divergence signals (e.g. price↑ + OI↓ exhaustion)

**Acceptance:** identical candle inputs always produce identical MarketState + setups
(golden-file tests); no candidate can exit the engine with RR < min or broken geometry.

## Phase 4 — Agent layer ✅ (this branch)

- [x] Schema-validated roles (Analyst / Strategist / Challenger), one retry, fail-closed
- [x] Strategist selects among pre-validated candidates (levels locked to engine output)
- [x] Risk challenger is advisory-only and recorded in the audit trail
- [x] Policy Gate wired into tools (`propose_trade` → `execute_approved_intent`)
- [x] `paper_broker_place_order` risk-gated (SL/TP required, size computed by kernel)
- [x] Per-symbol lanes replace global processing lock
- [x] Tool capability scopes per role (READ_MARKET / CREATE_INTENT / EXECUTE) — enforced
      at the API boundary by `src/security` (viewer/operator/trader/admin presets); the
      agent's tool layer never gains capabilities the authenticated caller lacks
- [ ] Agent state machine with explicit session context compilation

**Acceptance:** a prompt-injected strategist cannot exceed risk limits — fuzz the role
outputs through the pipeline and assert zero unapproved orders.

## Phase 5 — Learning ✅ core (this branch)

- [x] Trade feature extraction: every executed trade persists a feature snapshot
      (`trade.opened`: setup type, regime, direction, planned R:R, funding at entry,
      leverage, risk amount, notional, strategist confidence) keyed by decisionId
- [x] Outcome store: paper-venue realized closes carry order lineage (decisionId /
      strategyId) and attribute back by decisionId (`trade.closed`) — the ledger fully
      rebuilds from event-log replay; MAE/MFE tracked in R from mark observations
- [x] Grouping + statistics: per (setup × regime) cell statistics — expectancy in R,
      win rate, profit factor, dispersion, t-statistic, worst/best R, mean MAE/MFE
- [x] Strategy registry with versions and status (CANDIDATE/ACTIVE/RETIRED) and
      PRE-REGISTERED promotion gates (min sample, min expectancy, min win rate, min |t|,
      worst-R floor) — gates are frozen at registration, evaluated per cell, and every
      promotion/retirement is a persisted audit event
- [x] Registry + ledger hydrated at kernel boot; exposed on the kernel API surface
- [x] Performance analytics: portfolio summary with Sharpe/Sortino over the daily R
      series, plus segmentation by strategy / symbol / regime and per-cell statistics —
      served at `GET /api/kernel/analytics` (READ_PORTFOLIO)
- [x] Walk-forward with TRUE futures replay + OOS promotion + approved-cell
      enforcement (V3.1 — see below); `POST /api/kernel/walkforward/:symbol?apply`
      promotes OOS-verified cells into the live registry
- [ ] Wire journal lessons + strategy status into strategist context

**Acceptance:** a rule affects live behavior only after surviving the gate that was
declared before the outcomes were observed; every ACTIVE strategy reports expectancy,
sample size, and last-promoted-at (all persisted events, replayable).

### Walk-forward harness ✅ (this branch)

- [x] Deterministic replay: historical ladders bar-by-bar through the structure +
      setup engines (zero LLM); position-concurrency slots; time-stop + conservative
      stop-first ambiguity resolution; MAE/MFE in R
- [x] Outcome dataset feeds the SAME `computeCellStatistics` used live; every
      (setup × regime) cell is evaluated against the SAME frozen `checkGate`
      thresholds as live promotion — evidence can only come from this pipeline
- [x] `POST /api/kernel/walkforward/:symbol` (ADMIN) runs it over live-fetched
      history and returns cells + verdicts with explicit reasons

**Acceptance:** identical input yields byte-identical datasets; a cell can never be
promoted (live) without statistics that the harness could have produced.

### V3.1 — execution fidelity + research validity ✅ (this branch)

Review follow-up (8.8 → 9.3+ path): the remaining gap was concentrated in
research validity and execution fidelity, not architecture.

- [x] **Deterministic slippage enforcement (P0-1)** — every fill delta is checked
      against `expectedPrice ± maxSlippageBps` using the MARGINAL fill price
      (derived exactly from cumulative average folds); a breach persists a
      CRITICAL `execution.slippage_breach` audit event and cancels the un-filled
      remainder; a tolerance band without an anchor price is refused at submit
- [x] **Position-ID attribution (P0-2)** — fills ledger rebuilt on the netting
      model: `positionId → lots → fills → decisionId`; scale-ins append lots,
      exits close FIFO with one allocation per lot, opposite-side entries net
      down then flip; `position.opened` / `position.closed` audit events;
      restart replay NEVER re-fires the close fan-out (exactly-once); the
      TradeLedger's `trade.closed` is the single authoritative close event
      (PerformanceEngine records live-only and folds it on replay)
- [x] **True futures replay (P0-3)** — the simulator models contract constraints
      (lot rounding, min quantity/notional, leverage cap), per-side taker fees,
      per-side slippage on fill prices, signed funding over whole holding
      periods, margin utilization caps and position concurrency; unsizable
      geometry is skipped and counted (`skippedUnsizable`) exactly as the live
      sizer would reject it
- [x] **OOS promotion gate (P0-4)** — chronological IS/OOS split of the ladder;
      a cell is promotable only when BOTH samples pass the SAME frozen gate
      (aggregate-only promotion hides regime shifts); reasons are tagged
      `IS:` / `OOS:`; applying a run persists registrations + promotions with
      the approved-cell list
- [x] **Approved-cell enforcement (P0-5)** — `ACTIVE strategy + approved cell =
      tradable` enforced by a pipeline stage before sizing; unregistered
      strategies are rejected once ANY strategy is registered (bootstrap policy:
      an empty registry trades open, audited); `isCellTradable` survives restart
- [x] **Cross-venue real top-of-book (P1)** — Binance `bookTicker` stream feeds
      the market store; the gate uses REAL bid/ask when fresh (annotated
      `book_ticker`), falling back to the last-price proxy only when absent or
      stale (annotated `last_proxy`)

## Phase 6 — Production — security core ✅ (this branch)

- [x] API authentication + authorization: fail-closed Hono middleware — bearer
      `keyId:secret` credentials (timing-safe compare), per-key capability sets
      (READ_MARKET / READ_PORTFOLIO / READ_AUDIT / RUN_PIPELINE / CREATE_INTENT /
      EXECUTE / CONTROL_TRADE / ADMIN) via `viewer|operator|trader|admin` role presets
      from `KERNEL_API_KEYS`; with NO keys configured every kernel route returns 401
      (never open access); probe routes (`/health`, `/metrics`) stay public
- [x] Kill switch: durable global trading gate — boots HALTED (fail-safe), `halt()`/
      `resume()` persist `killswitch.set` events (actor + reason mandatory for resume),
      hydration replays history; enforced at THREE layers: pipeline returns `HALTED`
      before market data/LLM/venue work, execution engine refuses submissions
      (defense in depth, audited `order.blocked`), and API endpoints are
      capability-scoped (`CONTROL_TRADE` to halt, `ADMIN` to resume)
- [x] Privileged API calls are audited (`api.call` events: keyId, role, action)
- [ ] Secret management (no raw env keys for live venue), key scoping, rotation runbook
- [ ] Health/readiness probes, metrics backend, tracing, alerting (HALTED state pages)
- [ ] Fault-tolerance modes per dependency (Binance down = degraded data; CoinDCX down =
      no new risk — cross-venue gate now enforces the CoinDCX half)
- [ ] Chaos suite: WS drop, REST timeout, partial fill, exchange 5xx, reconcile storm
- [ ] Replay from event store (post-incident reconstruction of any decision)

**Acceptance:** chaos drills pass with invariants intact (no unauthorized risk, no lost
order, audit trail complete); unauthenticated request to any trading endpoint fails closed.
