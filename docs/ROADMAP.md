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
- [ ] Private WS streams (order/position updates) to drive FSM push-based
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
- [x] Pipeline refreshes live portfolio state every run (no more trading on stale/zero
      fallback equity)
- [ ] CoinDCX fills ledger → realized PnL for the LIVE venue (paper is complete)
- [ ] Wire `CrossVenueState` into the live pipeline gate (module + tests ready)
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
- [ ] Tool capability scopes per role (READ_MARKET / CREATE_INTENT / EXECUTE)
- [ ] Agent state machine with explicit session context compilation

**Acceptance:** a prompt-injected strategist cannot exceed risk limits — fuzz the role
outputs through the pipeline and assert zero unapproved orders.

## Phase 5 — Learning (next highest leverage)

- [ ] Trade feature extraction (setup type, regime, alignment, MAE/MFE, funding at entry)
- [ ] Outcome store keyed by decisionId (event store replay → trade ledger)
- [ ] Grouping + statistics (expectancy per setup×regime cell, R distributions)
- [ ] Rule candidates → backtest → walk-forward (train/validate/OOS) → paper → promote
- [ ] Strategy registry with versions, status (CANDIDATE/ACTIVE/RETIRED), promotion criteria
- [ ] Wire journal lessons + strategy status into strategist context

**Acceptance:** a rule affects live behavior only after surviving walk-forward OOS with
pre-registered thresholds; every ACTIVE strategy reports expectancy, sample size, and
last-promoted-at.

## Phase 6 — Production

- [ ] API authentication + authorization (the Hono surface is currently unauthenticated)
- [ ] Secret management (no raw env keys for live venue), key scoping, rotation runbook
- [ ] Health/readiness probes, metrics backend, tracing, alerting (HALTED state pages)
- [ ] Fault-tolerance modes per dependency (Binance down = degraded data; CoinDCX down =
      no new risk; DB down = halted)
- [ ] Chaos suite: WS drop, REST timeout, partial fill, exchange 5xx, reconcile storm
- [ ] Replay from event store (post-incident reconstruction of any decision)

**Acceptance:** chaos drills pass with invariants intact (no unauthorized risk, no lost
order, audit trail complete); unauthenticated request to any trading endpoint fails closed.
