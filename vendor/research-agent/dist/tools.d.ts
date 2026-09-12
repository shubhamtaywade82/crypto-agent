import { ToolkitCatalogue, type ToolResult } from '@nemesis-oss/agentic-runtime';
import type { ResearchContext } from './context.js';
/**
 * Build a {@link ToolkitCatalogue} of deterministic research tools bound to
 * the supplied {@link ResearchContext}.
 *
 * All tools are:
 *  - resourceClass: "local-cpu"
 *  - effects: "pure"
 *  - grantLevel: "auto"
 *
 * because they are pure functions over the in-memory dataset. No network,
 * no filesystem, no side effects. The model can re-dispatch them freely.
 */
export declare function createResearchTools(context: ResearchContext): ToolkitCatalogue;
/**
 * Invoke a single tool by handle deterministically, bypassing the LLM.
 *
 * Useful for testing, for CLIs that want to expose the deterministic surface
 * directly, and for users of `@nemesis-oss/crypto-agent` who want the
 * numerical results without spinning up Ollama.
 */
export declare function invokeToolDirect(catalogue: ToolkitCatalogue, handle: string, args: Record<string, unknown>): Promise<ToolResult>;
/** Re-export for tests that need the noop lease shape. */
export declare const __NOOP_LEASE: {
    readonly tag: "research-agent-local";
    readonly leaseMs: 30000;
    readonly maxResultBytes: 1000000;
    readonly auditTrailId: "local";
    readonly canClobberDisc: false;
};
//# sourceMappingURL=tools.d.ts.map