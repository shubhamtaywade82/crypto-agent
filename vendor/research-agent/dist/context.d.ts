import type { Candle, Timeframe } from '@nemesis-oss/market-events';
import type { HtfCandlesMap } from '@nemesis-oss/market-research';
/**
 * Dataset bound to a research agent.
 *
 * The agent does NOT see candles directly. Candles live here, in the
 * application context, and the deterministic tools draw on them. The LLM
 * only sees the projected outputs of tool calls.
 *
 * This separation is the architectural firewall between the model and the
 * data: the model cannot reason about prices it has not been told about,
 * and every numerical observation it produces must come from a tool call.
 */
export interface ResearchContext {
    /** Trading pair, e.g. "SOLUSDT" or "BTCUSDT". */
    readonly symbol: string;
    /** Timeframe of the primary working dataset. */
    readonly timeframe: Timeframe;
    /** Primary candle dataset the agent researches against. */
    readonly candles: readonly Candle[];
    /**
     * Optional higher-timeframe datasets used by multi-timeframe and
     * negative-evidence research. Keys are higher timeframes, values are
     * their candle arrays.
     */
    readonly htfCandles?: Readonly<Partial<Record<Timeframe, readonly Candle[]>>>;
}
/**
 * Convert a {@link ResearchContext} to the {@link HtfCandlesMap} shape that
 * `@nemesis-oss/market-research` consumes. Pure; safe to call at every tool
 * invocation. Returns `undefined` when no HTF candles are supplied.
 */
export declare function toHtfCandlesMap(ctx: ResearchContext): HtfCandlesMap | undefined;
//# sourceMappingURL=context.d.ts.map