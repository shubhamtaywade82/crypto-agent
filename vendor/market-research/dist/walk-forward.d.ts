import type { Candle, Timeframe } from '@nemesis-oss/market-events';
import type { ComponentStudyResult } from './types.js';
export interface FrozenHypothesis {
    readonly component: string;
    readonly hypothesisId: string;
    readonly hypothesisDescription: string;
    readonly trainSampleSize: number;
    readonly trainHitRateR2: number;
    readonly detectorConfigHash?: string | undefined;
    readonly outcomeConfigHash?: string | undefined;
}
export interface WalkForwardWindow {
    readonly windowIndex: number;
    readonly trainStartTime: number;
    readonly trainEndTime: number;
    readonly testStartTime: number;
    readonly testEndTime: number;
    readonly embargoBars?: number | undefined;
    readonly purgedTrainEventsCount?: number | undefined;
    readonly frozenHypotheses?: readonly FrozenHypothesis[] | undefined;
    readonly trainResults: readonly ComponentStudyResult[];
    readonly testResults: readonly ComponentStudyResult[];
}
export interface WalkForwardOptions {
    readonly symbol: string;
    readonly timeframe: Timeframe;
    readonly trainCandlesCount: number;
    readonly testCandlesCount: number;
    readonly stepCandlesCount: number;
    readonly horizonCandles?: number | undefined;
    readonly embargoBars?: number | undefined;
    readonly warmupBars?: number | undefined;
}
export interface StabilitySummary {
    readonly component: string;
    readonly windowsCount: number;
    readonly meanTrainHitRateR2: number;
    readonly meanTestHitRateR2: number;
    readonly hitRateDegradation: number;
    readonly isStable: boolean;
}
/**
 * Runs walk-forward out-of-sample validation:
 * Discovers best hypothesis on purged training window, freezes it,
 * and evaluates out-of-sample on unseen test window with continuous warmup state.
 */
export declare function runWalkForwardValidation(candles: readonly Candle[], options: WalkForwardOptions): {
    readonly windows: readonly WalkForwardWindow[];
    readonly stability: readonly StabilitySummary[];
};
/**
 * Formats WalkForward stability summary as a clean markdown table.
 */
export declare function formatStabilityMarkdown(stability: readonly StabilitySummary[]): string;
//# sourceMappingURL=walk-forward.d.ts.map