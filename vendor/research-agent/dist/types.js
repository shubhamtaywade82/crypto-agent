/**
 * Shared type aliases re-exported from underlying deterministic packages
 * so that consumers of the research agent do not need to depend on the
 * lower-level packages directly for common surface types.
 *
 * The agent itself never owns market-event or research logic; it only
 * invokes deterministic engines through tools.
 *
 * @packageDocumentation
 */
/** Event types the agent can dispatch to deterministic detectors. */
export const DETECTABLE_EVENT_TYPES = [
    'fvg',
    'bos',
    'choch',
    'mss',
    'order_block',
    'liquidity_sweep',
    'displacement',
];
//# sourceMappingURL=types.js.map