# @nemesis-oss/market-research-agent

> Agentic research interface for the deterministic market-intelligence
> engine. The LLM never owns numerical claims — every statistic in the
> final report originates from a tool call.

## What this package does

`market-research-agent` is a thin agentic wrapper around the deterministic
[`@nemesis-oss/market-events`](../market-events) and
[`@nemesis-oss/market-research`](../market-research) packages. It uses
[`@nemesis-oss/agentic-runtime`](https://www.npmjs.com/package/@nemesis-oss/agentic-runtime)
for the ReAct loop, tool dispatch, budgets, context compaction, and the
terminal synthesis seal.

The agent itself contains **no domain logic**. Every numerical claim it
produces must originate from a deterministic tool call. The runtime's
No-Tools Guarantee contract enforces this at seal time.

## Architecture

```
@nemesis-oss/agentic-runtime
                              │
                              ▼
                       research-agent   ← this package
                        /          \
                       ▼            ▼
             market-events    market-research
```

| Component | Responsibility |
| --- | --- |
| `market-events` | Detect what happened on the chart |
| `market-research` | Determine what the historical record says |
| `research-agent` | Decide what to investigate and how |
| `agentic-runtime` | Execute the agent loop |
| `@nemesis-oss/ollama-sdk` | Communicate with an Ollama server |
| MiniCPM5-2B (or any tool-calling model) | Research planning + interpretation |

## Install

This package is a pnpm workspace package. From the monorepo root:

```bash
pnpm install
pnpm --filter @nemesis-oss/market-research-agent build
```

To consume from an **external** repo (e.g. `crypto-agent`), add it as a
workspace dependency if you mirror the monorepo, or copy
`packages/research-agent/` into your own `packages/` directory and add a
`pnpm-workspace.yaml` entry. See the **Integration with crypto-agent**
section below.

## Quick start

```ts
import { createResearchAgent } from '@nemesis-oss/market-research-agent';
import { Decimal } from 'decimal.js';
import type { Candle } from '@nemesis-oss/market-events';

// 1. Bind the agent to a dataset.
const candles: Candle[] = /* fetched from your exchange adapter */;
const agent = createResearchAgent({
  symbol: 'SOLUSDT',
  timeframe: '15m',
  candles,
  // optional higher-timeframe datasets for HTF-conflict analysis
  htfCandles: {
    '1h': htfCandles1h,
    '4h': htfCandles4h,
  },
});

// 2. Ask a research question.
const result = await agent.research(`
  Investigate whether bullish FVGs on SOLUSDT 15m have statistically
  meaningful 2R follow-through.

  Compare their 2R reach rate against matched controls, examine sample
  size and confidence intervals, and determine whether the result
  remains meaningful after multiple-testing correction.
`);

// 3. Read the sealed report.
console.log(result.report);
console.log(result.status); // 'ACHIEVED' | 'PARTIAL' | 'CEDED' | 'FAILED'
console.log(result.dataset); // { symbol, timeframe, candleCount }
```

## CLI — question → Ollama → sealed report

From the monorepo root (requires a running Ollama server and a tool-capable model, default `openbmb/minicpm5-2b`):

```bash
# Preflight
pnpm run research -- --check-ollama

# Live Binance history
pnpm run research -- --symbol BTCUSDT --timeframe 15m --days 14 \
  --question "Does FVG show significant +2R uplift after FDR?"

# Cached dataset from live-study
pnpm run research -- --dataset packages/market-research/.datasets/BTCUSDT-15m.json

# Optional HTF context for negative-evidence tools
pnpm run research -- --symbol ETHUSDT --htf 1h,4h --model agent-core:latest
```

Integration test (local Ollama required):

```bash
OLLAMA_INTEGRATION=1 pnpm --filter @nemesis-oss/market-research-agent test test/ollama.integration.test.ts
```

The agent never sees the candles directly — they live in the
`ResearchContext`. The model only sees the projected outputs of tool
calls. This is the architectural firewall between the LLM and the data.

## Configuration

All options are optional and have sensible defaults:

| Option | Default | Description |
| --- | --- | --- |
| `ollamaBaseUrl` | `process.env.OLLAMA_BASE_URL` or `http://localhost:11434` | Ollama HTTP base URL |
| `model` | `process.env.RESEARCH_AGENT_MODEL` or `openbmb/minicpm5-2b` | Ollama model alias |
| `maxSteps` | `12` | Max cognitive steps (LLM turns) per run |
| `maxIntents` | `16` | Hard cap on tool intent count per run |
| `wallTimeMs` | `180_000` (3 min) | Wall-clock ceiling per run |
| `maxTokensPerStep` | `4_000` | Max tokens per LLM call |
| `numCtx` | `32_768` | Model context window (num_ctx) |
| `idleLiveSeconds` | `300` | Ollama idle keep-alive |
| `timeoutMs` | `120_000` | Per-request timeout |
| `retries` | `2` | Per-request retries |
| `reserveFreshTailCount` | `10` | Verbatim tail retained across context compaction |

## Tools exposed to the LLM

All tools are `resourceClass: "local-cpu"`, `effects: "pure"`,
`grantLevel: "auto"`. The model can re-dispatch them freely.

| Tool | Description |
| --- | --- |
| `list_event_detectors` | List the available deterministic detectors |
| `detect_events` | Run a detector (fvg, bos, choch, mss, order_block, liquidity_sweep, displacement, vsa) and return events with full provenance |
| `get_market_context` | Compute regime/ATR/session/HTF snapshot at a candle index |
| `run_study` | Universal empirical study with matched controls, CIs, and Benjamini-Hochberg FDR |
| `run_event_study` | Single-event-type empirical study |
| `evaluate_interaction` | Pairwise and anchor-based event interactions (incremental contribution, redundancy) |
| `evaluate_negative_evidence` | HTF-conflict, early-failure, invalidated-zone impact on hit rate |
| `run_walk_forward` | Out-of-sample walk-forward stability validation |
| `dataset_summary` | Compact dataset overview; ground the model at the start of every run |

Every tool result is tagged `trustLevel: "verified"` because the
underlying engines are deterministic. Failed invocations are tagged
`trustLevel: "unverified"` and surfaced with an `error` field — the model
is expected to either retry with corrected args or report the failure in
its final report rather than invent a value.

## Direct (non-LLM) tool invocation

When you want the deterministic numbers without spinning up Ollama — for
a CLI, a backtest harness, or a unit test — call tools directly:

```ts
const agent = createResearchAgent({ symbol: 'ETHUSDT', timeframe: '15m', candles });

const summary = await agent.invokeTool('dataset_summary', {});
const fvgEvents = await agent.invokeTool('detect_events', { eventType: 'fvg' });
const study = await agent.invokeTool('run_event_study', {
  eventType: 'fvg',
  horizonCandles: 24,
});
```

This is the same surface the LLM uses, so anything you build around it
transfers directly into the agentic flow.

## Decimal-safe serialization

The deterministic engines return `Decimal` instances for full-precision
prices. `JSON.stringify(new Decimal('1.5'))` returns `'{}'`, so every
tool output passes through `serializeForTool` first — Decimal becomes a
full-precision string, and large arrays are clamped to fit the runtime's
context budget (default 44 KB per tool result).

## Integration with `crypto-agent`

This package is designed to slot cleanly into
[`shubhamtaywade82/crypto-agent`](https://github.com/shubhamtaywade82/crypto-agent)
as a third pnpm workspace package. The integration path:

1. **Mirror the monorepo layout.** In `crypto-agent`, ensure your
   `pnpm-workspace.yaml` lists `packages/*`. Copy the entire
   `market-intelligence/packages/research-agent/` directory to
   `crypto-agent/packages/research-agent/`. (Or vendor it as a git
   submodule / pnpm file dependency if you prefer.)

2. **Add the workspace dependencies.** If `crypto-agent` does not already
   have `market-events` and `market-research`, add them too — they are
   required for the deterministic engine to compile. The dependency
   chain is documented in `docs/architecture.md`.

3. **Wire the candle pipeline.** `crypto-agent` typically fetches candles
   from a Binance or Bybit adapter. Convert them to the `Candle` shape
   expected by `market-events` (Decimal-typed OHLCV with ms timestamps),
   then construct a `ResearchContext`:

   ```ts
   import { createResearchAgent } from '@nemesis-oss/market-research-agent';
   import { Decimal } from 'decimal.js';

   const candles = binanceKlines.map(k => ({
     timestamp: k.openTime,
     open: new Decimal(k.open),
     high: new Decimal(k.high),
     low: new Decimal(k.low),
     close: new Decimal(k.close),
     volume: new Decimal(k.volume),
   }));

   const agent = createResearchAgent({
     symbol: 'ETHUSDT',
     timeframe: '15m',
     candles,
     htfCandles: { '1h': htfCandles1h, '4h': htfCandles4h },
   });
   ```

4. **Call `agent.research(question)`** from your strategy / signal layer.
   The return value's `report` field is a sealed string suitable for
   logging or sending to a downstream consumer.

5. **Reuse the deterministic surface in your backtest harness.** Use
   `agent.invokeTool(...)` to obtain exact sample sizes, p-values, and
   walk-forward stability numbers without invoking Ollama. This lets
   your backtest and your agent share the same source of truth.

The dependency direction is one-way: `research-agent` depends on
`market-events` and `market-research`, never the reverse. `crypto-agent`
depends on `research-agent` and is free to add its own higher-level
strategy code on top.

## License

Proprietary. See monorepo root.
