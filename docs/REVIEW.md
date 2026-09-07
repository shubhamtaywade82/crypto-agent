# crypto-agent — End-to-End Review (Staff Engineer + Trader Lens)

> Review of `main` @ `b8e4ff3` ("feat: implement trade journaling and adaptive learning tools"),
> verified line-by-line against the source, with the v2 kernel work on
> `feat/coindcx-execution` factored in as "on branch" deltas.

## Executive verdict

crypto-agent **was** a credible agentic harness wrapped around a non-existent trading system.
The ReAct loop, streaming, tool registry, rate-limit guardian and watcher were genuinely good
engineering. Everything *downstream of the LLM's decision* — risk, sizing, execution,
reconciliation, recovery — was either missing, naive, or worse: *simulated success*
(`MOCK_FILLED` with no fill model, no stop, no cap).

That inversion is the classic failure mode of LLM trading projects: the model is treated as
the trading system instead of as one (fallible, untrusted) component of one.

The branch `feat/coindcx-execution` inverts the architecture: a deterministic trading kernel
(domain → engines → execution → audit) owns every stateful trading decision, the LLM layer is
restructured into schema-validated roles that can only *propose*, and Binance is demoted to a
market-data-only provider while CoinDCX becomes the sole execution venue.

| Capability | main | on branch | target | gap to target |
|---|---|---|---|---|
| Agent framework | 7.5 | 8.5 | 9.5 | backtest/walk-forward gate for roles |
| Harness / tool architecture | 7.0 | 8.5 | 9.5 | capability-based tool scopes |
| Autonomous operation | 5.5 | 7.5 | 9.0 | position supervisor daemon, WS-driven state |
| Market intelligence | 5.0 | 8.5 | 9.5 | FVG/order blocks, OI divergence signals |
| Trading / risk | 3.5 | 8.5 | 9.5 | portfolio VaR, correlation matrix |
| Learning | 4.0 | 4.5 | 9.0 | experiment system (Phase 5) |
| Execution | 3.0 | 8.0 | 9.5 | live CoinDCX soak test, private WS streams |
| Reliability | 5.0 | 7.5 | 9.5 | chaos tests, degradation modes per subsystem |
| Security | 3.5 | 4.5 | 9.0 | API auth, secret management, audit sign-off |
| Futures readiness | 2.5 | 8.0 | 9.5 | funding-aware exits, multi-asset margin |
| Observability | 5.0 | 7.5 | 9.5 | metrics/tracing backends, alerting |
| Testing | 6.0 | 8.5 | 9.5 | contract tests against live sandbox |
| **Overall** | **5.1** | **7.6** | **9.5** | |

## What was actually wrong on `main` (verified, with receipts)

1. **The LLM could execute freely.** `scanner.ts` instructed the model to
   `execute paper_broker_place_order`; `tools.ts` POSTed it to an HTTP service and on any
   failure returned `{status: 'MOCK_FILLED', simulated: true}` — a fabricated fill with
   **no stop loss, no take profit, no size limit, no risk check**. One hallucinated
   `quantity` string away from a real loss on a real venue.
2. **Position sizing was `balance × risk%` with `ROUND_DOWN` to 4dp.** No fees, no slippage,
   no funding, no lot step, no min-notional, no leverage/margin constraint, no correlation
   to the exchange's actual contract rules (`tools.ts::executePositionSize`).
3. **A global boolean governed the loop.** `orchestrator.ts` `private processing = false` —
   a SOL trigger arriving during a BTC re-analysis was **silently dropped**. Under load this
   is data loss, not backpressure.
4. **No order lifecycle.** There was no state machine, no `SUBMITTING/UNKNOWN` distinction,
   no reconciliation with any broker, no client-order-id idempotency. A timeout meant the
   system *didn't know whether it had a position* — and had no way to find out.
5. **No futures domain model.** Funding rate, open interest, mark vs index, maintenance
   margin, liquidation price, tick/lot/minNotional — none existed anywhere in the code.
6. **The journal's outcome rule was `pnlPercent > 0.2 ? WIN : LOSS`.** A 0.21% move on a
   10x-leveraged position is not the same event as the same move on spot; R-multiples existed
   but MAE/MFE were absent, so "learning" had no features to learn from.
7. **Unauthenticated Hono surface** (`/api/chat`, SSE stream) — fine for a local toy,
   disqualifying for anything holding keys.

## What the branch adds (map to phases)

- **Phase 1 — kernel** (`src/domain/`, `src/engines/`): canonical `MarketState`, order FSM
  incl. `UNKNOWN`, `TradeValidator` (direction-dependent SL/TP geometry + min-R:R hard gate),
  `PositionSizer` (risk budget → stop distance → fees → slippage → funding → lot step →
  min-notional → notional cap → margin → final risk re-check), `RiskEngine` with 9
  deterministic checks and a 5-state circuit breaker, prop-firm envelope defaults
  (0.25%/trade, 1%/day, 2x, min RR 2.5, 2 positions, 3-loss streak).
- **Phase 2 — execution**: `IExecutionBroker` with explicit capabilities; Binance provider
  is *structurally incapable* of placing orders (it only implements `IMarketDataProvider`);
  `CoinDCXExecutionBroker` with idempotent `client_order_id` (= decisionId), TPSL attach,
  leverage, INR/USDT auto-fallback with live USDTINR FX; `ExecutionEngine` FSM runtime;
  `Reconciler` as the *only* component allowed to resolve `UNKNOWN`; deterministic
  in-process paper venue with fees/slippage/TP-SL simulation.
- **Phase 3 — intelligence**: swings → BOS/CHoCH → trend; Wilder RSI/MACD/ATR; volatility
  percentile regimes; 9-state regime classifier; liquidity levels + sweep detection; weighted
  4h→5m alignment score; 4 deterministic setup detectors (pullback-reclaim, sweep-reversal,
  breakout-retest, trend-continuation) whose candidates are pre-validated.
- **Phase 4 — agent layer**: Analyst / Strategist / Risk-Challenger roles with Zod-validated
  structured output, one retry, fail-closed; the strategist *chooses among already-validated
  candidates* rather than inventing levels; challenger objections are recorded but never gate
  (the RiskEngine is the only gate); `paper_broker_place_order` is now risk-gated — the LLM
  cannot place a naked or self-sized order anymore.
- **Cross-cutting**: per-symbol `SymbolLanes` replace the global lock; JSONL event store with
  `decisionId` correlation on every state transition; structured logger; kernel CLI
  (`npm run kernel`) and `/api/kernel/*` observability endpoints.
- **Tests**: 111 passing (44 legacy + 67 new), including fast-check property suites proving
  risk ≤ budget, SL<entry<TP geometry, lot alignment, liquidation geometry, FSM safety.
  Two real bugs were found and fixed by these tests before ever running against an exchange.

## What still stands between this branch and 9.5 (tracked in ROADMAP.md)

1. **Learning is still a journal, not an experiment system** — feature extraction, grouping,
   hypothesis → backtest → walk-forward → promotion (Phase 5). Highest-leverage next work.
2. **No backtester/replay harness yet** — the engines are pure functions, so replay is
   straightforward, but the replay loop and strategy versioning don't exist yet.
3. **Security is unchanged** — the API surface is still unauthenticated, secrets are still
   env vars. Do not point `EXECUTION_VENUE=coindcx` at real keys until Phase 6 lands.
4. **Portfolio metrics are pluggable but default to zero** — daily PnL/drawdown/loss-streak
   need wiring to the journal + event store in production.
5. **Contract tests against CoinDCX sandbox** — the adapter is typed against the SDK and
   paper-tested; it needs a recorded-fixture contract suite + a soak test before real INR.

## The architectural law (now enforced in code)

```
LLM roles (analyst / strategist / challenger)
        │  Zod-validated proposals only
        ▼
  TradeValidator ──► PositionSizer ──► RiskEngine.evaluate()
                                          │
                              APPROVED ───┴── REJECTED (terminal)
                                          ▼
                            ExecutionEngine (FSM + idempotency)
                                          ▼
                            Reconciler / Position supervisor
                                          ▼
                            EventStore (decisionId audit trail)
```

No code path exists — in tools, pipeline, or kernel — where an LLM output reaches an
exchange without passing through that gauntlet. That is the single most important property
of this branch.
