import { type RunResult, type ToolkitCatalogue } from '@nemesis-oss/agentic-runtime';
import type { ResearchContext } from './context.js';
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
export declare class ResearchAgent {
    private readonly runner;
    private readonly context;
    private readonly catalogue;
    private readonly contextManager;
    constructor(context: ResearchContext, options?: ResearchAgentOptions);
    /** Run a research question to completion and return a sealed report. */
    research(question: string): Promise<ResearchOutcome>;
    /**
     * Direct (non-LLM) tool invocation. Useful for tests, CLIs, or consumers
     * that want the deterministic numbers without spinning up Ollama.
     */
    invokeTool(handle: string, args?: Record<string, unknown>): Promise<ToolResult>;
    /** The catalogue, exposed for tests and introspection. */
    get tools(): ToolkitCatalogue;
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
export declare function createResearchAgent(context: ResearchContext, options?: ResearchAgentOptions): ResearchAgent;
//# sourceMappingURL=agent.d.ts.map