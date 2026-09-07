# ADR-001 — Binance is market-data-only; CoinDCX is the sole execution venue

Status: Accepted (on `feat/coindcx-execution`)
Date: 2026-09-07
Deciders: repo owner, agent kernel work

## Context

The system needs USDT-quoted market intelligence (depth of history, futures microstructure:
funding, open interest, mark/index prices) and an execution venue usable from India with INR
funding rails.

Concretely:

- Binance has the deepest liquid markets and the best futures *data* APIs
  (`premiumIndex`, `openInterest`, funding history, kline ladders, WS streams) via
  `@nemesis-oss/binance-sdk`.
- Executing on Binance from India is not practical for this account setup (INR rails,
  regulatory friction).
- CoinDCX mirrors Binance price action closely (its perps track Binance marks) and offers
  USDT-margined (`B-SOL_USDT`) and INR-margined (`B-SOL_INR`) futures, INR deposits, and
  idempotent order creation via `client_order_id`. The `@nemesis-oss/coindcx-sdk` exposes
  spot/margin/futures, a Socket.IO WS, safety limits, and a built-in paper engine.

## Decision

1. **Binance is used only through `IMarketDataProvider`.** The type has no order, position,
   account, or private-WS surface. The compiler enforces the policy: there is no code path
   from Binance to an order.
2. **All order/position/account operations go through `IExecutionBroker`**, implemented by
   `CoinDCXExecutionBroker` (live) or `PaperExecutionBroker` (default, deterministic
   in-process simulator). The kernel never calls a venue SDK directly.
3. **Pair routing is explicit.** `SymbolRouter` maps a Binance symbol (e.g. `SOLUSDT`) to the
   best CoinDCX futures pair: USDT-margined preferred (1:1 price parity with Binance data),
   automatic INR fallback when the USDT perp is not listed. INR routes convert kernel-side
   USDT prices through a live USDTINR spot rate with a cached TTL; all kernel risk math stays
   USDT-denominated and converts only at the adapter boundary.
4. **Idempotency is mandatory.** Kernel `decisionId` is passed as the venue
   `client_order_id`; the SDK's retry policy is safe for POSTs carrying it (CoinDCX rejects
   reused ids instead of double-executing).
5. **Default venue is `paper`.** Live CoinDCX requires `EXECUTION_VENUE=coindcx` plus keys —
   an explicit, deliberate act.

## Consequences

- **Positive**
  - Risk math is venue-independent and unit-tested; venue quirks are quarantined in adapters.
  - India-compatible funding rails without giving up Binance-grade market data.
  - The paper venue exercises the exact same `IExecutionBroker` contract as live code, so
    pipeline tests are representative.
  - Swapping or adding a venue (e.g. a DEX aggregator later) is an adapter, not a rewrite.
- **Negative / risks**
  - Price basis risk between Binance data and CoinDCX marks; mitigated by sizing buffers
    (slippage rate) and per-instrument contract specs, not eliminated.
  - INR routes carry FX risk (USDTINR drift inside the cache TTL; 5 minutes).
  - CoinDCX futures market depth can be thinner than Binance — min-notional caps and the
    prop-firm envelope keep order sizes conservative.
  - Two SDKs, two rate-limit regimes; the venue adapter must respect CoinDCX token buckets
    (handled inside the SDK).
- **Neutral**
  - Binance keys are no longer needed at all for data-only operation (public endpoints).

## Enforcement

- `IMarketDataProvider` capability list contains only `MARKET_DATA`.
- `BinanceMarketDataProvider` has no execution methods and holds only the public client.
- `RiskEngine` approval is required before `ExecutionEngine.submit` is reachable; the only
  tools exposed to the LLM route through `assess()`/`executeProposal()`.
- Property + unit tests pin these invariants (see `test/kernel-property-invariants.test.ts`).
