/**
 * Convert a {@link ResearchContext} to the {@link HtfCandlesMap} shape that
 * `@nemesis-oss/market-research` consumes. Pure; safe to call at every tool
 * invocation. Returns `undefined` when no HTF candles are supplied.
 */
export function toHtfCandlesMap(ctx) {
    if (!ctx.htfCandles || Object.keys(ctx.htfCandles).length === 0) {
        return undefined;
    }
    return ctx.htfCandles;
}
//# sourceMappingURL=context.js.map