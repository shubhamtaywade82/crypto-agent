import type { ComponentStudyResult } from './types.js';
export interface TimeframeCell {
    readonly timeframe: string;
    readonly sampleSize: number;
    readonly hitRateR2: number;
    readonly medianMfeAtr: number;
    readonly medianMaeAtr: number;
    readonly fullFillRate: number | null;
    readonly ciLower?: number | undefined;
    readonly ciUpper?: number | undefined;
    readonly uplift?: number | undefined;
    readonly isSignificant?: boolean | undefined;
}
export interface EffectivenessRow {
    readonly component: string;
    readonly cells: Record<string, TimeframeCell>;
}
export interface EffectivenessMatrixReport {
    readonly symbol: string;
    readonly generatedAt: number;
    readonly rows: EffectivenessRow[];
}
/**
 * Aggregates multi-timeframe study results into an effectiveness matrix report with statistical confidence.
 */
export declare function buildEffectivenessMatrix(symbol: string, studies: readonly ComponentStudyResult[]): EffectivenessMatrixReport;
/**
 * Formats an EffectivenessMatrixReport as a clean terminal / markdown table with statistical significance indicator (*).
 */
export declare function formatMatrixMarkdown(report: EffectivenessMatrixReport, timeframes: readonly string[]): string;
//# sourceMappingURL=matrix-report.d.ts.map