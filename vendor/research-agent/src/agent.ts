import {
  AgentRunner,
  ContextManager,
  createOllamaThoughtProcess,
  type RunResult,
  type ToolkitCatalogue,
} from '@nemesis-oss/agentic-runtime';

import type { ResearchContext } from './context.js';
import { createResearchTools, invokeToolDirect } from './tools.js';
import { RESEARCH_AGENT_CHARTER, RESEARCH_DIGEST_STYLE_HINT } from './prompts.js';
import type { ToolResult } from '@nemesis-oss/agentic-runtime';

/** Options for constructing a {@link ResearchAgent}. */
export interface ResearchAgentOptions {
  /** Ollama HTTP base URL. Defaults to env OLLAMA_BASE_URL, then to localhost. */
  readonly ollamaBaseUrl?: string;
  /**
   * Model alias for the primary research brain. Defaults to env
   * RESEARCH_AGENT_MODEL, then to "openbmb/minicpm5-2b" (a small model
   * capable of tool-calling that fits a single consumer GPU).
   */
  readonly model?: string;
  /** Max cognitive steps (LLM turns). Defaults to 12. */
  readonly maxSteps?: number;
  /** Hard cap on tool intent count. Defaults to 16. */
  readonly maxIntents?: number;
  /** Wall-clock ceiling per run, in ms. Defaults to 180_000 (3 minutes). */
  readonly wallTimeMs?: number;
  /** Max tokens per LLM call. Defaults to 4_000. */
  readonly maxTokensPerStep?: number;
  /** Model context window (num_ctx). Defaults to 32_768. */
  readonly numCtx?: number;
  /** Idle keep-alive seconds for the Ollama model. Defaults to 300. */
  readonly idleLiveSeconds?: number;
  /** Per-request timeout, ms. Defaults to 120_000. */
  readonly timeoutMs?: number;
  /** Per-request retries. Defaults to 2. */
  readonly retries?: number;
  /** Verbatim tail messages retained across compaction. Defaults to 10. */
  readonly reserveFreshTailCount?: number;
}

/** Outcome of {@link ResearchAgent#research}. */
export interface ResearchOutcome extends RunResult {
  /** The bound dataset summary, surfaced for downstream consumers. */
  readonly dataset: {
    readonly symbol: string;
    readonly timeframe: string;
    readonly candleCount: number;
  };
}

/**
 * Thin agentic wrapper around the deterministic research engines.
 *
 * Responsibilities:
 *  - bind the {@link ResearchContext} (symbol, timeframe, candles, optional HTF)
 *  - construct an Ollama-backed {@link ThoughtProcess} as the LLM brain
 *  - build a {@link ToolkitCatalogue} of deterministic research tools
 *  - wire the {@link AgentRunner} with sane budgets and the research charter
 *
 * The agent itself owns NO domain logic. Every numerical claim in the final
 * report must trace back to a tool call. The runner's terminal synthesis
 * engine (No-Tools Guarantee) enforces this contract.
 */
export class ResearchAgent {
  private readonly runner: AgentRunner;
  private readonly context: ResearchContext;
  private readonly catalogue: ToolkitCatalogue;
  private readonly contextManager: ContextManager;

  constructor(context: ResearchContext, options: ResearchAgentOptions = {}) {
    this.context = context;

    const baseUrl =
      options.ollamaBaseUrl ??
      process.env.OLLAMA_BASE_URL ??
      'http://localhost:11434';

    const model =
      options.model ??
      process.env.RESEARCH_AGENT_MODEL ??
      'openbmb/minicpm5-2b';

    const numCtx = options.numCtx ?? 32_768;

    const brain = createOllamaThoughtProcess(baseUrl, model, {
      timeoutMs: options.timeoutMs ?? 120_000,
      retries: options.retries ?? 2,
      numCtx,
      idleLiveSeconds: options.idleLiveSeconds ?? 300,
    });

    this.catalogue = createResearchTools(context);

    this.contextManager = new ContextManager({
      modelCapacityTokenCeiling: numCtx,
      reserveFreshTailCount: options.reserveFreshTailCount ?? 10,
      digestStyleHint: RESEARCH_DIGEST_STYLE_HINT,
    });

    this.runner = new AgentRunner({
      brain,
      catalogue: this.catalogue,
      contextManager: this.contextManager,
      adminCharter: RESEARCH_AGENT_CHARTER,
      budgets: {
        maxCogStepN: options.maxSteps ?? 12,
        hardIntentCount: options.maxIntents ?? 16,
        wallTimeCeilMs: options.wallTimeMs ?? 180_000,
        maxTokensPerStep: options.maxTokensPerStep ?? 4_000,
      },
      laneMode: 'replace',
    });
  }

  /** Run a research question to completion and return a sealed report. */
  async research(question: string): Promise<ResearchOutcome> {
    const result = await this.runner.run(question);
    return {
      ...result,
      dataset: {
        symbol: this.context.symbol,
        timeframe: this.context.timeframe,
        candleCount: this.context.candles.length,
      },
    };
  }

  /**
   * Direct (non-LLM) tool invocation. Useful for tests, CLIs, or consumers
   * that want the deterministic numbers without spinning up Ollama.
   */
  async invokeTool(
    handle: string,
    args: Record<string, unknown> = {},
  ): Promise<ToolResult> {
    return invokeToolDirect(this.catalogue, handle, args);
  }

  /** The catalogue, exposed for tests and introspection. */
  get tools(): ToolkitCatalogue {
    return this.catalogue;
  }
}

/**
 * Factory: create a {@link ResearchAgent} bound to a dataset.
 *
 * @example
 * ```ts
 * import { createResearchAgent } from '@nemesis-oss/market-research-agent';
 *
 * const agent = createResearchAgent({
 *   symbol: 'SOLUSDT',
 *   timeframe: '15m',
 *   candles,
 * });
 *
 * const result = await agent.research(
 *   'Investigate whether bullish FVGs on SOLUSDT 15m have meaningful 2R follow-through.',
 * );
 * console.log(result.report);
 * ```
 */
export function createResearchAgent(
  context: ResearchContext,
  options?: ResearchAgentOptions,
): ResearchAgent {
  return new ResearchAgent(context, options);
}
