import { describe, it, expect } from 'vitest';
import { Decimal } from 'decimal.js';
import type { Candle } from '@nemesis-oss/market-events';

import { createResearchAgent } from '../src/agent.js';
import type { ResearchContext } from '../src/context.js';

/* ------------------------------------------------------------------ *
 * Synthetic dataset
 *
 * A long-enough trending+rangey OHLCV series that produces non-trivial
 * counts of FVGs, swings, BOS, CHoCH, MSS, order blocks, sweeps, and
 * displacement events. Seeded (no Math.random) so the test is
 * deterministic. 300 candles is enough for one walk-forward window of
 * 100 train + ~24 embargo + 50 test, and small enough that detect_events
 * output fits the 44KB tool-output budget without truncation.
 * ------------------------------------------------------------------ */

const FIFTEEN_MIN = 15 * 60_000;

function makeCandles(count: number, startTs = 1_700_000_000_000): Candle[] {
  const candles: Candle[] = [];
  let price = 100;
  for (let i = 0; i < count; i++) {
    // Multiple sine layers produce trend + reversal + range structure.
    const drift =
      Math.sin(i / 13) * 0.8 +
      Math.sin(i / 47) * 0.4 +
      Math.sin(i / 137) * 1.2;
    const open = price;
    const close = price + drift + (i % 7 === 0 ? -2.5 : 0); // periodic displacement
    const high = Math.max(open, close) + Math.abs(Math.sin(i / 3)) * 1.2 + (i % 11 === 0 ? 0.8 : 0);
    const low = Math.min(open, close) - Math.abs(Math.cos(i / 3)) * 1.2 - (i % 17 === 0 ? 0.8 : 0);
    const volume = 1000 + Math.abs(Math.sin(i / 5)) * 500;
    candles.push({
      timestamp: startTs + i * FIFTEEN_MIN,
      open: new Decimal(open.toFixed(4)),
      high: new Decimal(high.toFixed(4)),
      low: new Decimal(low.toFixed(4)),
      close: new Decimal(close.toFixed(4)),
      volume: new Decimal(volume.toFixed(4)),
    });
    price = close;
  }
  return candles;
}

function makeContext(): ResearchContext {
  return {
    symbol: 'SOLUSDT',
    timeframe: '15m',
    candles: makeCandles(300),
  };
}

/* ------------------------------------------------------------------ *
 * Research-semantics integration test
 *
 * Verifies that the deterministic tool surface, when called in the
 * expected research order, produces a coherent end-to-end narrative
 * that the agent's LLM would be able to cite in a sealed FinalReport.
 *
 * This test does NOT spin up Ollama — it uses ResearchAgent#invokeTool
 * to exercise the deterministic pipeline directly. The LLM brain is
 * never constructed.
 * ------------------------------------------------------------------ */

describe('research-semantics end-to-end (no Ollama)', () => {
  it('answers "Does bullish FVG continuation on SOLUSDT 15m provide statistically significant 2R edge?" with a coherent evidence chain', async () => {
    const agent = createResearchAgent(makeContext());

    // Step 1: Ground in the dataset.
    const summary = await agent.invokeTool('dataset_summary', {});
    expect(summary.success).toBe(true);
    const summaryOut = summary.output as {
      symbol: string;
      timeframe: string;
      candleCount: number;
      detectorCounts: Record<string, number>;
    };
    expect(summaryOut.symbol).toBe('SOLUSDT');
    expect(summaryOut.timeframe).toBe('15m');
    expect(summaryOut.candleCount).toBe(300);
    expect(summaryOut.detectorCounts.fvg).toBeGreaterThan(0);

    // Step 2: Detect FVG events (observation).
    const fvgDetection = await agent.invokeTool('detect_events', { eventType: 'fvg' });
    expect(fvgDetection.success).toBe(true);
    const fvgOut = fvgDetection.output as {
      count: number;
      events: Array<{ direction: 'bullish' | 'bearish'; originIndex: number; availableAtIndex: number }>;
    };
    expect(fvgOut.count).toBeGreaterThan(0);
    expect(fvgOut.events.length).toBe(fvgOut.count);
    // Every event must carry causal provenance.
    for (const ev of fvgOut.events) {
      expect(ev.availableAtIndex).toBeGreaterThanOrEqual(ev.originIndex);
    }

    // Step 3: Run the single-event empirical study (statistical evidence).
    const fvgStudy = await agent.invokeTool('run_event_study', {
      eventType: 'fvg',
      horizonCandles: 24,
    });
    expect(fvgStudy.success).toBe(true);
    const studyOut = fvgStudy.output as {
      result: {
        eventType: string;
        sampleSize: number;
        reachRates: { r1: number; r2: number; r3: number };
        baselineComparisonR2?: {
          baselineProbability: number;
          uplift: number;
          isStatisticallySignificant: boolean;
          pValueEstimate: number;
          adjustedPValue?: number;
          isFdrSignificant?: boolean;
        };
        confidenceIntervalR2?: { lower: number; upper: number };
      } | null;
    };
    expect(studyOut.result).not.toBeNull();
    const result = studyOut.result!;
    expect(result.sampleSize).toBeGreaterThan(0);
    expect(result.reachRates.r2).toBeGreaterThanOrEqual(0);
    expect(result.reachRates.r2).toBeLessThanOrEqual(1);

    // The evidence chain must be citeable: baseline, uplift, p-value, CI.
    if (result.baselineComparisonR2) {
      const bc = result.baselineComparisonR2;
      expect(typeof bc.baselineProbability).toBe('number');
      expect(typeof bc.uplift).toBe('number');
      expect(typeof bc.pValueEstimate).toBe('number');
      expect(bc.pValueEstimate).toBeGreaterThanOrEqual(0);
      expect(bc.pValueEstimate).toBeLessThanOrEqual(1);
    }
    if (result.confidenceIntervalR2) {
      const ci = result.confidenceIntervalR2;
      expect(ci.lower).toBeLessThanOrEqual(ci.upper);
    }

    // Step 4: Check for negative evidence (HTF conflict, early failures).
    // Without HTF candles in context, this still reports local signals.
    const negEvidence = await agent.invokeTool('evaluate_negative_evidence', {
      eventType: 'fvg',
      htf: '1h',
    });
    expect(negEvidence.success).toBe(true);
    const negOut = negEvidence.output as {
      impact: {
        sampleSize: number;
        alignedHitRateR2: number;
        conflictedHitRateR2: number;
        conflictPenalty: number;
        netEvidenceScore: number;
      };
    };
    expect(negOut.impact.sampleSize).toBeGreaterThanOrEqual(0);
    expect(negOut.impact.alignedHitRateR2).toBeGreaterThanOrEqual(0);
    expect(negOut.impact.alignedHitRateR2).toBeLessThanOrEqual(1);

    // Step 5: Validate out-of-sample stability via walk-forward.
    const walkForward = await agent.invokeTool('run_walk_forward', {
      trainCandlesCount: 100,
      testCandlesCount: 50,
      stepCandlesCount: 50,
      horizonCandles: 24,
    });
    expect(walkForward.success).toBe(true);
    const wfOut = walkForward.output as {
      windowCount: number;
      windows: Array<{
        windowIndex: number;
        trainStartTime: number;
        testStartTime: number;
        trainResults: Array<{ eventType: string; sampleSize: number; reachRate2R: number }>;
        testResults: Array<{ eventType: string; sampleSize: number; reachRate2R: number }>;
      }>;
      stability: Array<{
        component: string;
        windowsCount: number;
        meanTrainHitRateR2: number;
        meanTestHitRateR2: number;
        hitRateDegradation: number;
        isStable: boolean;
      }>;
      stabilityMarkdown: string;
    };
    expect(wfOut.windowCount).toBeGreaterThan(0);
    // Per-window data is now available for citation.
    expect(wfOut.windows.length).toBe(wfOut.windowCount);
    for (const w of wfOut.windows) {
      expect(w.trainResults.length).toBeGreaterThan(0);
      expect(w.testResults.length).toBeGreaterThan(0);
      // FVG should be present in at least one window's train and test.
      const fvgInTrain = w.trainResults.some((r) => r.eventType === 'fvg');
      const fvgInTest = w.testResults.some((r) => r.eventType === 'fvg');
      expect(fvgInTrain || fvgInTest).toBe(true);
    }
    // Stability summary aggregates per component.
    const fvgStability = wfOut.stability.find((s) => s.component === 'fvg');
    if (fvgStability) {
      expect(typeof fvgStability.isStable).toBe('boolean');
      expect(typeof fvgStability.hitRateDegradation).toBe('number');
    }
    // Markdown rendering is present for direct inclusion in a report.
    expect(wfOut.stabilityMarkdown).toContain('Walk-Forward Stability');
    expect(wfOut.stabilityMarkdown).toContain('FVG');

    // Step 6 (optional): Cross-direction interaction with BOS.
    // Tests that requireDirectionMatch=false works for cross-direction research.
    const interaction = await agent.invokeTool('evaluate_interaction', {
      eventA: 'fvg',
      eventB: 'bos',
      requireDirectionMatch: false,
      requirePriorOrCoincident: true,
    });
    expect(interaction.success).toBe(true);
    const intOut = interaction.output as {
      pair: {
        primaryType: string;
        secondaryType: string;
        sampleSizePrimary: number;
        sampleSizeSecondary: number;
        interactionUplift: number;
        redundancyScore: number;
      };
      anchor: {
        anchorType: string;
        conditionalUplift: number;
        coOccurrenceRate: number;
      };
      requireDirectionMatch: boolean;
    };
    expect(intOut.pair.primaryType).toBe('fvg');
    expect(intOut.pair.secondaryType).toBe('bos');
    expect(intOut.requireDirectionMatch).toBe(false);
    expect(intOut.pair.redundancyScore).toBeGreaterThanOrEqual(0);
    expect(intOut.pair.redundancyScore).toBeLessThanOrEqual(1);
  });

  it('produces JSON-serializable outputs across the full pipeline (no Decimal bleed)', async () => {
    const agent = createResearchAgent(makeContext());

    const tools = [
      ['dataset_summary', {}],
      ['list_event_detectors', {}],
      ['detect_events', { eventType: 'fvg' }],
      ['get_market_context', { candleIndex: 100 }],
      ['run_study', {}],
      ['run_event_study', { eventType: 'fvg' }],
      ['evaluate_interaction', { eventA: 'fvg', eventB: 'liquidity_sweep' }],
      ['evaluate_negative_evidence', { eventType: 'fvg' }],
      ['run_walk_forward', { trainCandlesCount: 100, testCandlesCount: 50, stepCandlesCount: 50 }],
    ] as const;

    for (const [handle, args] of tools) {
      const res = await agent.invokeTool(handle, args as Record<string, unknown>);
      expect(res.success, `${handle} should succeed`).toBe(true);
      // Every output must survive JSON.stringify without losing Decimal precision.
      const json = JSON.stringify(res.output);
      expect(json.length, `${handle} output should be non-empty`).toBeGreaterThan(2);
      expect(json, `${handle} should not contain empty-object Decimal bleed`).not.toMatch(/\{\}/);
    }
  });
});
