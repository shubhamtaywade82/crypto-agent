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
export function buildEffectivenessMatrix(
  symbol: string,
  studies: readonly ComponentStudyResult[]
): EffectivenessMatrixReport {
  const byComponent: Record<string, Record<string, TimeframeCell>> = {};

  for (const study of studies) {
    if (!byComponent[study.eventType]) {
      byComponent[study.eventType] = {};
    }

    byComponent[study.eventType]![study.timeframe] = {
      timeframe: study.timeframe,
      sampleSize: study.sampleSize,
      hitRateR2: study.hitRates.r2,
      medianMfeAtr: study.medianMfeAtr,
      medianMaeAtr: study.medianMaeAtr,
      fullFillRate: study.fullFillRate,
      ciLower: study.confidenceIntervalR2?.lower,
      ciUpper: study.confidenceIntervalR2?.upper,
      uplift: study.baselineComparisonR2?.uplift,
      isSignificant: study.baselineComparisonR2?.isStatisticallySignificant
    };
  }

  const rows: EffectivenessRow[] = Object.entries(byComponent).map(([component, cells]) => ({
    component,
    cells
  }));

  return {
    symbol,
    generatedAt: Date.now(),
    rows
  };
}

/**
 * Formats an EffectivenessMatrixReport as a clean terminal / markdown table with statistical significance indicator (*).
 */
export function formatMatrixMarkdown(report: EffectivenessMatrixReport, timeframes: readonly string[]): string {
  const header = `| Component | ${timeframes.map(tf => `${tf} (+2R [95% CI] / MFE / Δ)`).join(' | ')} |`;
  const separator = `| :--- | ${timeframes.map(() => ':---:').join(' | ')} |`;

  const body = report.rows.map(row => {
    const cols = timeframes.map(tf => {
      const cell = row.cells[tf];
      if (!cell || cell.sampleSize === 0) return '-';
      const pct = (cell.hitRateR2 * 100).toFixed(1);
      const ci = cell.ciLower !== undefined && cell.ciUpper !== undefined
        ? `[${(cell.ciLower * 100).toFixed(0)}-${(cell.ciUpper * 100).toFixed(0)}%]`
        : '';
      const sig = cell.isSignificant ? '*' : '';
      const upliftPct = cell.uplift !== undefined ? `${cell.uplift >= 0 ? '+' : ''}${(cell.uplift * 100).toFixed(1)}pp` : '';
      return `${pct}%${sig} ${ci} (${cell.medianMfeAtr.toFixed(1)} ATR, ${upliftPct}, n=${cell.sampleSize})`;
    });
    return `| ${row.component.toUpperCase()} | ${cols.join(' | ')} |`;
  });

  return [
    `# Effectiveness Matrix: ${report.symbol}`,
    `*Asterisk (*) indicates statistically significant positive edge over unconditional baseline (p < 0.05).`,
    '',
    header,
    separator,
    ...body
  ].join('\n');
}
