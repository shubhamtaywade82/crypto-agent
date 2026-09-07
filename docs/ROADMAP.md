# ROADMAP — crypto-agent 9+

Phased plan with acceptance criteria. Phases 1–4 are implemented on
`feat/coindcx-execution`; phases 5–6 remain open work.

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
