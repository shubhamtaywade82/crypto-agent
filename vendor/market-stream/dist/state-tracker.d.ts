import type { Candle, Timeframe } from '@nemesis-oss/market-events';
import type { MarketState, DetectableEventType } from './types.js';
import type { CandleBuffer } from './candle-buffer.js';
/**
 * Maintains a {@link MarketState} for a single symbol+timeframe by
 * processing closed candles from a {@link CandleBuffer}.
 *
 * On each new closed candle:
 *  1. Push the candle into the buffer.
 *  2. Extract the market context (trend, volatility, ATR, session) using
 *     {@link extractContextSnapshot} from market-research.
 *  3. Run the configured event detectors on the buffer.
 *  4. Filter events to only those whose `availableAtIndex` falls within
 *     the last `eventLookbackBars` candles.
 *  5. Emit the updated MarketState.
 *
 * The detector set is configurable. Running all 7 detectors on every
 * candle is the most expensive option; users who only need FVG detection
 * can pass `detectors: ['fvg']`.
 */
export declare class StateTracker {
    private readonly symbol;
    private readonly timeframe;
    private readonly buffer;
    private state;
    private readonly detectors;
    private readonly eventLookbackBars;
    constructor(symbol: string, timeframe: Timeframe, buffer: CandleBuffer, detectors: readonly DetectableEventType[] | null, eventLookbackBars: number);
    /**
     * Process a new closed candle and return the updated MarketState, or
     * null if the buffer is too small for context extraction.
     */
    onCandle(candle: Candle): MarketState | null;
    /** Get the current state without producing a new one. */
    get current(): MarketState | null;
    /**
     * Run the configured detectors on the candle buffer and return only
     * events whose `availableAtIndex` falls within the last
     * `eventLookbackBars` candles.
     */
    private detectEvents;
}
//# sourceMappingURL=state-tracker.d.ts.map