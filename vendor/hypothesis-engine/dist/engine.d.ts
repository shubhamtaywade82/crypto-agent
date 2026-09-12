import type { Candle, Timeframe } from '@nemesis-oss/market-events';
import { type CompositeRegime } from '@nemesis-oss/regime-engine';
/**
 * A research hypothesis proposed by the LLM and tested by the engine.
 *
 * Example:
 *   "Bullish FVGs are more reliable when:
 *    - HTF structure is bullish
 *    - price has swept sell-side liquidity
 *    - displacement > 1.5 ATR
 *    - OI is increasing"
 */
export interface Hypothesis {
    readonly id: string;
    readonly description: string;
    readonly symbol: string;
    readonly timeframe: Timeframe;
    /** The event type being tested (e.g. "fvg"). */
    readonly eventType: string;
    /** The target metric (default "hit2R"). */
    readonly targetMetric?: 'hit1R' | 'hit2R' | 'hit3R';
    /** Optional regime filter: only test events in this regime. */
    readonly regimeFilter?: Partial<CompositeRegime> | undefined;
    /** Optional displacement threshold (in ATR multiples). */
    readonly minDisplacementAtr?: number | undefined;
    /** Whether to require a prior liquidity sweep. */
    readonly requirePriorSweep?: boolean | undefined;
    /** Horizon for outcome evaluation. Default 24 candles. */
    readonly horizonCandles?: number | undefined;
}
/**
 * The verdict on a hypothesis after deterministic testing.
 */
export type HypothesisVerdict = 'validated' | 'rejected' | 'inconclusive' | 'insufficient_sample';
export interface HypothesisResult {
    readonly hypothesis: Hypothesis;
    readonly verdict: HypothesisVerdict;
    readonly sampleSize: number;
    readonly reachRate: number;
    readonly baselineRate: number;
    readonly uplift: number;
    readonly pValue: number;
    readonly isFdrSignificant: boolean;
    readonly oosReachRate?: number | undefined;
    readonly oosDegradation?: number | undefined;
    readonly evidenceSummary: string;
    readonly testedAt: number;
}
export interface TestHypothesisOptions {
    readonly candles: readonly Candle[];
    readonly htfCandles?: Readonly<Partial<Record<Timeframe, readonly Candle[]>>>;
    readonly trainCandlesCount?: number;
    readonly testCandlesCount?: number;
    readonly stepCandlesCount?: number;
}
/**
 * Test a hypothesis deterministically.
 *
 * 1. Detect events of the hypothesis's event type.
 * 2. Apply the hypothesis's filters (regime, displacement, prior sweep).
 * 3. Run the empirical study on the filtered event set.
 * 4. If sample is sufficient, run walk-forward OOS validation.
 * 5. Return a verdict: validated / rejected / inconclusive / insufficient_sample.
 */
export declare function testHypothesis(hypothesis: Hypothesis, options: TestHypothesisOptions): HypothesisResult;
//# sourceMappingURL=engine.d.ts.map