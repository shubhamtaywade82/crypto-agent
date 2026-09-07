# 🤖 AI Agent & Developer Architecture Guide

Master guide for human engineers and AI coding assistants (Antigravity, Cursor, Claude Code, Copilot) developing or extending `crypto-agent`.

---

## 1. System Mental Model: The Two-Layer Split

```
LLM ReAct Layer (src/agents, src/agent.ts)
  │  - Non-deterministic idea generator & qualitative synthesis (gemma4:31b)
  │  - Advisory roles: Analyst, Strategist, Risk Challenger
  │  - CANNOT place direct exchange orders
  ▼
Deterministic Trading Kernel (src/domain, src/engines, src/infrastructure)
  │  - Hard gatekeeper: Zero hallucinations permitted
  │  - Mathematical validation: SL < Entry < TP geometry, min R:R (>= 2.5)
  │  - Position sizing: decimal.js (equity, risk %, fees, slippage, lot step)
  │  - Risk governor: Circuit breakers (NORMAL → CAUTION → REDUCED → HALTED)
  ▼
Execution Broker (IExecutionBroker)
     - Paper simulator (default) OR CoinDCX Futures (idempotent client_order_id)
```

**The Golden Rule:** The LLM only *proposes* ideas. The deterministic kernel *validates, sizes, risk-checks, and executes*. Binance is structurally restricted to public market data only (`IMarketDataProvider`); it has no order placement capability.

---

## 2. Directory Structure & Responsibilities

| Path | Purpose | Key Constraints |
|---|---|---|
| `src/domain/` | Pure business types, financial invariants, risk configs | Zero external dependencies; pure functions and types only |
| `src/engines/` | Deterministic calculations (market state, structure, setups, sizing, risk) | Must be 100% unit-tested; Decimal for money math |
| `src/agents/` | Multi-role ReAct agent definitions (Analyst, Strategist, Risk Challenger) | Zod-validated schemas; fail-closed fallbacks |
| `src/engine/` | Self-improving journal (`TradeJournal`) & dynamic price watcher | Local JSON persistence (`~/.crypto_agent_journal.json`) |
| `src/infrastructure/` | Concrete adapters (Binance market data, CoinDCX broker, Paper HTTP, logger) | Adapts external APIs to internal domain interfaces |
| `src/guardians/` | Binance API rate-limit guardian (`BinanceRateLimiter`) | 1200 weight cap rolling 60s window |
| `src/notifications/` | Telegram webhook alerts | Non-blocking telemetry |
| `src/ui/` | Ink React terminal TUI and history | CLI visualization |
| `src/tools.ts` | Tools exposed to the standard ReAct agent loop | Uses `@nemesis-oss/ollama-sdk` `defineTool` |
| `src/tools-kernel.ts` | Kernel inspection & proposal tools for the LLM | Calls `getKernel()`, `buildMarketState`, `detectSetups` |
| `src/server.ts` | Hono HTTP REST, SSE streaming (`/api/chat/stream`), Web UI dashboard | Serves TradingView charts and chat UI on `:3002` |
| `src/kernel-cli.ts` | Autonomous 5-minute background loop daemon | Continuous daemon scanning configured symbols |

---

## 3. Strict Coding Standards (Non-Negotiable)

Follow `~/.ai/CODE_QUALITY.md`:

1. **Simplicity First (KISS / YAGNI):**
   - Write flat, linear logic. No speculative abstractions, factories, or single-implementation service classes.
   - Do NOT create new files unless explicitly requested. Propose before creating helpers/modules.
2. **Hard Metrics:**
   - Functions ≤ 30 lines.
   - Files ≤ 300 lines.
   - Nesting ≤ 3 levels (use early returns / guard clauses).
   - Parameters ≤ 4 (use options object if > 4).
3. **Type Safety & Financial Arithmetic:**
   - Zero `any`. All types must be strictly typed or validated with Zod.
   - **Always use `Decimal` (`decimal.js`)** for financial arithmetic (sizing, equity, risk, fees). Never raw JavaScript float math for money calculations.
4. **Comments:**
   - Comments explain **WHY**, never **WHAT**.
5. **Git Hygiene:**
   - Never commit automatically. Ask for user approval before committing.
   - Do NOT add `Co-Authored-By:` lines to commit messages.
6. **Protected Repositories:**
   - **NEVER modify `/home/nemesis/project/trading-workspace/paper-broker`**. It is an external standalone service. Interacts only via HTTP REST (`:3000`).

---

## 4. Domain Invariants & Risk Envelope

Default prop-firm risk settings (`src/domain/risk/risk-config.ts`):
- **Risk Per Trade:** Default `0.25%` of equity (capped strictly by policy).
- **Daily Loss Limit:** `1.0%` (trips circuit breaker to `HALTED`).
- **Max Drawdown:** `5.0%` (trips circuit breaker to `EMERGENCY`).
- **Minimum R:R:** `2.5` (any setup with reward/risk < 2.5 is rejected).
- **Max Leverage:** `2x` on futures.
- **Max Open Positions:** `2` concurrent positions.
- **9 Market Regimes (`src/domain/market/types.ts`):** `TREND_UP`, `TREND_DOWN`, `RANGE`, `BREAKOUT`, `COMPRESSION`, `EXPANSION`, `HIGH_VOLATILITY`, `LOW_VOLATILITY`, `PANIC`.

---

## 5. Developer & AI Cookbooks

### Recipe A: Adding a New Setup/Strategy
1. Open [`src/engines/setup-engine.ts`](file:///home/nemesis/project/trading-workspace/bots/crypto-agent/src/engines/setup-engine.ts).
2. Add your setup type name to `SetupType`:
   ```ts
   export type SetupType = 'PULLBACK_RECLAIM' | 'LIQUIDITY_SWEEP_REVERSAL' | 'BREAKOUT_RETEST' | 'TREND_CONTINUATION' | 'YOUR_NEW_SETUP';
   ```
3. Implement a deterministic detector function taking `(state: MarketState, limits: RiskLimits)`:
   - Identify entry, structural stop loss, and liquidity target from swings / order blocks.
   - Ensure `rrOf(direction, entry, stop, tp) >= limits.minRiskRewardRatio`.
4. Call detector inside `detectSetups()` and push valid candidates.
5. Add unit tests in `test/kernel-structure.test.ts` or a new test in `test/`.

### Recipe B: Exposing a New Tool to the LLM
1. Open [`src/tools-kernel.ts`](file:///home/nemesis/project/trading-workspace/bots/crypto-agent/src/tools-kernel.ts) (or [`src/tools.ts`](file:///home/nemesis/project/trading-workspace/bots/crypto-agent/src/tools.ts)).
2. Define the tool using `defineTool` from `@nemesis-oss/ollama-sdk`:
   ```ts
   export const myNewTool = defineTool({
     name: 'my_new_tool',
     description: 'Explain clearly what this does and when LLM should invoke it',
     schema: z.object({
       symbol: z.string().describe('Target symbol, e.g. BTCUSDT'),
     }),
     execute: async (args) => {
       // Deterministic execution logic
       return { success: true };
     },
   });
   ```
3. Add the tool to the exported tools array (`kernelTools` in `src/tools-kernel.ts` or `tools` in `src/tools.ts`).
4. Verify rate-limit handling if calling Binance public endpoints (`await rateLimiter.requestPermission('my_tool')`).

### Recipe C: Self-Improving Trade Journal Lifecycle
1. **Log Setup:** Before entry, the LLM calls `log_trade_setup` with symbol, direction, entry, SL, TP, and rationale. State is recorded as `PLANNED`.
2. **Execute:** When filled, status transitions to `EXECUTED`.
3. **Post-Mortem Outcome:** When trade closes, calling `record_trade_outcome(tradeId, exitPrice, postMortemNotes)` computes PnL and R-multiple.
4. **Iterative Memory Injection:** `TradeJournal.formatPromptContext()` formats past lessons, win-rate, and common mistakes directly into the LLM's system prompt on subsequent turns.

---

## 6. Verification Checklist

Before proposing or accepting any code changes:
- [ ] Run `npm run typecheck` (zero TypeScript errors).
- [ ] Run `npm run lint` (zero ESLint errors).
- [ ] Run `npm test` (all unit and property tests pass).
- [ ] Verify file length ≤ 300 lines (`wc -l <file>`).
- [ ] Verify function length ≤ 30 lines.
- [ ] Confirm no floating-point arithmetic used for financial calculations (`Decimal` only).
- [ ] Confirm `paper-broker` repo was not touched.
