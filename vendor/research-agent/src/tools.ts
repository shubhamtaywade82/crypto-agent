import { z } from 'zod';
import {
  detectFvg,
  detectSwings,
  detectStructureBreaks,
  detectBos,
  detectChoch,
  detectMss,
  detectOrderBlocks,
  detectLiquiditySweeps,
  detectDisplacement,
  type BaseEvent,
  type Candle,
  type Timeframe,
} from '@nemesis-oss/market-events';

import {
  extractContextSnapshot,
  runObservationStudy,
  runUniversalStudy,
  analyzeEventPairInteraction,
  analyzeAnchorInteraction,
  evaluateNegativeEvidenceImpact,
  runWalkForwardValidation,
  formatStabilityMarkdown,
} from '@nemesis-oss/market-research';

import {
  ToolkitCatalogue,
  type ToolResult,
  type ToolDefinition,
} from '@nemesis-oss/agentic-runtime';

import type { ResearchContext } from './context.js';
import { toHtfCandlesMap } from './context.js';
import { DETECTABLE_EVENT_TYPES, type DetectableEventType } from './types.js';
import { serializeForTool, clampToolOutput } from './serialize.js';

/* ------------------------------------------------------------------ *
 * Helpers
 * ------------------------------------------------------------------ */

/** A no-op sandbox lease used when calling tools directly (for testing). */
const NOOP_LEASE = {
  tag: 'research-agent-local',
  leaseMs: 30_000,
  maxResultBytes: 1_000_000,
  auditTrailId: 'local',
  canClobberDisc: false,
} as const;

/** A never-aborting cancel token used for direct invocation. */
const NO_CANCEL = new AbortController().signal;

/**
 * Build a ToolResult for a successful deterministic computation.
 * Deterministic outputs are always "verified" - the model may treat every
 * number returned as ground truth for citation in its final report.
 */
function verifiedResult(name: string, output: unknown, startedAt: number): ToolResult {
  return {
    toolCallId: crypto.randomUUID(),
    name,
    success: true,
    output: serializeForTool(output),
    trustLevel: 'verified',
    executionTimeMs: Date.now() - startedAt,
  };
}

/** Build a ToolResult for a failed computation. */
function failedResult(name: string, error: unknown, startedAt: number): ToolResult {
  const message = error instanceof Error ? error.message : String(error);
  return {
    toolCallId: crypto.randomUUID(),
    name,
    success: false,
    error: message,
    output: null,
    trustLevel: 'unverified',
    executionTimeMs: Date.now() - startedAt,
  };
}

/**
 * Run a deterministic event detector against the bound dataset.
 * Throws on unknown event types so the caller surfaces a clear failure.
 */
function getEvents(
  ctx: ResearchContext,
  eventType: DetectableEventType,
): readonly BaseEvent[] {
  const { candles, symbol, timeframe } = ctx;

  const swings = detectSwings(candles, { leftBars: 2, rightBars: 2 });
  const structure = detectStructureBreaks(candles, swings, {
    symbol,
    timeframe,
  });

  switch (eventType) {
    case 'fvg':
      return detectFvg(candles, { symbol, timeframe });

    case 'bos':
      return detectBos(candles, swings, { symbol, timeframe });

    case 'choch':
      return detectChoch(candles, swings, { symbol, timeframe });

    case 'mss':
      return detectMss(candles, swings, { symbol, timeframe });

    case 'order_block':
      return detectOrderBlocks(candles, structure, { symbol, timeframe });

    case 'liquidity_sweep':
      return detectLiquiditySweeps(candles, swings, { symbol, timeframe });

    case 'displacement':
      return detectDisplacement(candles, { symbol, timeframe });

    default: {
      // exhaustive at compile time; runtime guard for safety
      const _exhaustive: never = eventType;
      throw new Error(`Unknown event type: ${String(_exhaustive)}`);
    }
  }
}

/**
 * Build the (potentially truncated) list of detector names the model can
 * dispatch to. Surfaced as a tool so the model can self-discover the
 * available surface without it being baked into the charter.
 */
function listDetectorNames(): readonly DetectableEventType[] {
  return DETECTABLE_EVENT_TYPES;
}

/* ------------------------------------------------------------------ *
 * Catalogue factory
 * ------------------------------------------------------------------ */

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
export function createResearchTools(context: ResearchContext): ToolkitCatalogue {
  const catalogue = new ToolkitCatalogue();

  /* -- 1. discovery ------------------------------------------------- */

  catalogue.place({
    handle: 'list_event_detectors',
    caption:
      'List the deterministic market-event detectors available for research on this dataset.',
    argsShape: z.object({}),
    resourceClass: 'local-cpu',
    effects: 'pure',
    grantLevel: 'auto',
    discoverability: {
      keywords: ['list', 'detectors', 'events', 'available'],
      category: 'discovery',
      priority: 10,
    },
    invoke: async () => {
      const started = Date.now();
      return verifiedResult('list_event_detectors', listDetectorNames(), started);
    },
  } satisfies ToolDefinition<Record<string, never>>);

  /* -- 2. event detection ------------------------------------------ */

  catalogue.place({
    handle: 'detect_events',
    caption:
      'Run a deterministic market-event detector against the current dataset and return the detected events with full provenance (origin index, available-at index, direction, timeline).',
    argsShape: z.object({
      eventType: z.enum(DETECTABLE_EVENT_TYPES),
    }),
    resourceClass: 'local-cpu',
    effects: 'pure',
    grantLevel: 'auto',
    discoverability: {
      keywords: ['detect', 'events', 'fvg', 'bos', 'choch', 'mss', 'order_block', 'liquidity_sweep', 'displacement'],
      category: 'observation',
      priority: 9,
    },
    invoke: async (args) => {
      const started = Date.now();
      try {
        const events = getEvents(context, args.eventType);
        const output = clampToolOutput({
          symbol: context.symbol,
          timeframe: context.timeframe,
          eventType: args.eventType,
          count: events.length,
          events,
        });
        return verifiedResult('detect_events', output, started);
      } catch (err) {
        return failedResult('detect_events', err, started);
      }
    },
  } satisfies ToolDefinition<{ eventType: DetectableEventType }>);

  /* -- 3. market context snapshot --------------------------------- */

  catalogue.place({
    handle: 'get_market_context',
    caption:
      'Calculate the deterministic market context (trend regime, volatility regime, ATR, session, optional HTF context) at a specified candle index. Use this to qualify event observations with the regime they occurred in.',
    argsShape: z.object({
      candleIndex: z.number().int().min(0),
    }),
    resourceClass: 'local-cpu',
    effects: 'pure',
    grantLevel: 'auto',
    discoverability: {
      keywords: ['context', 'regime', 'trend', 'volatility', 'atr', 'session', 'htf'],
      category: 'context',
      priority: 8,
    },
    invoke: async (args) => {
      const started = Date.now();
      try {
        const index = Math.min(args.candleIndex, context.candles.length - 1);
        if (index < 0) {
          throw new Error('candleIndex must be >= 0 and the dataset must be non-empty');
        }
        const snapshot = extractContextSnapshot(
          context.candles,
          index,
          toHtfCandlesMap(context),
        );
        const candle = context.candles[index];
        return verifiedResult(
          'get_market_context',
          {
            symbol: context.symbol,
            timeframe: context.timeframe,
            candleIndex: index,
            timestamp: candle ? candle.timestamp : null,
            context: snapshot,
          },
          started,
        );
      } catch (err) {
        return failedResult('get_market_context', err, started);
      }
    },
  } satisfies ToolDefinition<{ candleIndex: number }>);

  /* -- 4. universal empirical study -------------------------------- */

  catalogue.place({
    handle: 'run_study',
    caption:
      'Run the deterministic universal market-event research study across all event types. Returns per-event-type sample sizes, reach rates (1R/2R/3R), matched-control baseline comparison, Wilson confidence intervals, and Benjamini-Hochberg multiple-testing adjustment.',
    argsShape: z.object({
      horizonCandles: z.number().int().positive().default(24),
      ambiguityPolicy: z
        .enum(['pessimistic', 'optimistic', 'ambiguous'])
        .default('pessimistic'),
    }),
    resourceClass: 'local-cpu',
    effects: 'pure',
    grantLevel: 'auto',
    discoverability: {
      keywords: ['study', 'universal', 'empirical', 'baseline', 'confidence', 'multiple_testing'],
      category: 'research',
      priority: 7,
    },
    invoke: async (args) => {
      const started = Date.now();
      try {
        const study = runObservationStudy(context.candles, {
          symbol: context.symbol,
          timeframe: context.timeframe,
          horizonCandles: args.horizonCandles,
          ambiguityPolicy: args.ambiguityPolicy,
          htfCandlesMap: toHtfCandlesMap(context),
        });
        const output = clampToolOutput({
          symbol: context.symbol,
          timeframe: context.timeframe,
          candleCount: context.candles.length,
          horizonCandles: args.horizonCandles,
          ambiguityPolicy: args.ambiguityPolicy,
          results: study.results,
          multipleTesting: study.multipleTesting,
          matchRatios: Object.fromEntries(study.matchRatios),
        });
        return verifiedResult('run_study', output, started);
      } catch (err) {
        return failedResult('run_study', err, started);
      }
    },
  } satisfies ToolDefinition<{
    horizonCandles: number;
    ambiguityPolicy: 'pessimistic' | 'optimistic' | 'ambiguous';
  }>);

  /* -- 5. single-event study --------------------------------------- */

  catalogue.place({
    handle: 'run_event_study',
    caption:
      'Run deterministic empirical research for one specific event type. Returns the same shape as run_study but scoped to a single detector, so the model can drill into one hypothesis at a time.',
    argsShape: z.object({
      eventType: z.enum(DETECTABLE_EVENT_TYPES),
      horizonCandles: z.number().int().positive().default(24),
    }),
    resourceClass: 'local-cpu',
    effects: 'pure',
    grantLevel: 'auto',
    discoverability: {
      keywords: ['study', 'event', 'single', 'fvg', 'bos', 'choch', 'mss', 'order_block', 'liquidity_sweep', 'displacement'],
      category: 'research',
      priority: 7,
    },
    invoke: async (args) => {
      const started = Date.now();
      try {
        const all = runUniversalStudy(context.candles, {
          symbol: context.symbol,
          timeframe: context.timeframe,
          horizonCandles: args.horizonCandles,
          htfCandlesMap: toHtfCandlesMap(context),
        });
        const study = all.find((r) => r.eventType === args.eventType) ?? null;
        return verifiedResult(
          'run_event_study',
          {
            symbol: context.symbol,
            timeframe: context.timeframe,
            eventType: args.eventType,
            horizonCandles: args.horizonCandles,
            result: study,
          },
          started,
        );
      } catch (err) {
        return failedResult('run_event_study', err, started);
      }
    },
  } satisfies ToolDefinition<{
    eventType: DetectableEventType;
    horizonCandles: number;
  }>);

  /* -- 6. pairwise interaction ------------------------------------- */

  catalogue.place({
    handle: 'evaluate_interaction',
    caption:
      'Evaluate whether two event types co-occur with statistically meaningfully different outcomes versus either alone. Returns interaction uplift, incremental contributions, and redundancy score. Use this to test combinations like FVG + liquidity sweep. Set requireDirectionMatch=false to analyse cross-direction interactions (e.g. bearish BOS as a filter for bullish FVG outcomes).',
    argsShape: z.object({
      eventA: z.enum(DETECTABLE_EVENT_TYPES),
      eventB: z.enum(DETECTABLE_EVENT_TYPES),
      targetMetric: z.enum(['hit1R', 'hit2R', 'hit3R']).default('hit2R'),
      maxBarGap: z.number().int().positive().default(3),
      horizonCandles: z.number().int().positive().default(24),
      requireDirectionMatch: z.boolean().default(true),
      requirePriorOrCoincident: z.boolean().default(true),
    }),
    resourceClass: 'local-cpu',
    effects: 'pure',
    grantLevel: 'auto',
    discoverability: {
      keywords: ['interaction', 'combination', 'pair', 'incremental', 'redundancy', 'cross_direction'],
      category: 'research',
      priority: 6,
    },
    invoke: async (args) => {
      const started = Date.now();
      try {
        const observationsA = buildObservations(args.eventA, args.horizonCandles);
        const observationsB = buildObservations(args.eventB, args.horizonCandles);

        const pair = analyzeEventPairInteraction(
          observationsA,
          observationsB,
          args.targetMetric,
          args.maxBarGap,
        );

        const anchor = analyzeAnchorInteraction(
          observationsA,
          observationsB.map((o) => o.event),
          {
            targetMetric: args.targetMetric,
            maxBarGap: args.maxBarGap,
            requireDirectionMatch: args.requireDirectionMatch,
            requirePriorOrCoincident: args.requirePriorOrCoincident,
          },
        );

        return verifiedResult(
          'evaluate_interaction',
          {
            symbol: context.symbol,
            timeframe: context.timeframe,
            horizonCandles: args.horizonCandles,
            targetMetric: args.targetMetric,
            requireDirectionMatch: args.requireDirectionMatch,
            requirePriorOrCoincident: args.requirePriorOrCoincident,
            pair,
            anchor,
          },
          started,
        );
      } catch (err) {
        return failedResult('evaluate_interaction', err, started);
      }
    },
  } satisfies ToolDefinition<{
    eventA: DetectableEventType;
    eventB: DetectableEventType;
    targetMetric: 'hit1R' | 'hit2R' | 'hit3R';
    maxBarGap: number;
    horizonCandles: number;
    requireDirectionMatch: boolean;
    requirePriorOrCoincident: boolean;
  }>);

  /* -- 7. negative evidence impact -------------------------------- */

  catalogue.place({
    handle: 'evaluate_negative_evidence',
    caption:
      'Measure the degradation in empirical hit rate caused by contradictory or negative evidence (HTF conflict, early failure, invalidated zones). Returns aligned vs. conflicted hit rates and a net evidence score. Requires HTF candles in the research context for HTF-conflict analysis; otherwise reports local-only signals.',
    argsShape: z.object({
      eventType: z.enum(DETECTABLE_EVENT_TYPES),
      htf: z
        .enum(['1h', '2h', '4h', '6h', '8h', '12h', '1d'])
        .default('1h'),
      horizonCandles: z.number().int().positive().default(24),
    }),
    resourceClass: 'local-cpu',
    effects: 'pure',
    grantLevel: 'auto',
    discoverability: {
      keywords: ['negative', 'evidence', 'conflict', 'htf', 'invalidated', 'early_failure'],
      category: 'research',
      priority: 5,
    },
    invoke: async (args) => {
      const started = Date.now();
      try {
        const observations = buildObservations(args.eventType, args.horizonCandles);
        const impact = evaluateNegativeEvidenceImpact(observations, args.htf);
        return verifiedResult(
          'evaluate_negative_evidence',
          {
            symbol: context.symbol,
            timeframe: context.timeframe,
            eventType: args.eventType,
            htf: args.htf,
            horizonCandles: args.horizonCandles,
            impact,
          },
          started,
        );
      } catch (err) {
        return failedResult('evaluate_negative_evidence', err, started);
      }
    },
  } satisfies ToolDefinition<{
    eventType: DetectableEventType;
    htf: Timeframe;
    horizonCandles: number;
  }>);

  /* -- 8. walk-forward stability ---------------------------------- */

  catalogue.place({
    handle: 'run_walk_forward',
    caption:
      'Run deterministic walk-forward out-of-sample validation. Discovers the best hypothesis on a purged training window, freezes it, then evaluates on an unseen test window with continuous warmup state. Returns per-window train/test hit rates and stability summary. Use this to test whether a finding survives out-of-sample.',
    argsShape: z.object({
      trainCandlesCount: z.number().int().positive(),
      testCandlesCount: z.number().int().positive(),
      stepCandlesCount: z.number().int().positive(),
      horizonCandles: z.number().int().positive().default(24),
      embargoBars: z.number().int().nonnegative().optional(),
    }),
    resourceClass: 'local-cpu',
    effects: 'pure',
    grantLevel: 'auto',
    discoverability: {
      keywords: ['walk_forward', 'oos', 'out_of_sample', 'stability', 'validation'],
      category: 'research',
      priority: 5,
    },
    invoke: async (args) => {
      const started = Date.now();
      try {
        const result = runWalkForwardValidation(context.candles, {
          symbol: context.symbol,
          timeframe: context.timeframe,
          trainCandlesCount: args.trainCandlesCount,
          testCandlesCount: args.testCandlesCount,
          stepCandlesCount: args.stepCandlesCount,
          horizonCandles: args.horizonCandles,
          embargoBars: args.embargoBars,
        });
        // Project per-window data to a compact, model-citable shape.
        // Full WalkForwardWindow objects carry nested train/test results
        // arrays that would blow the context budget; we keep only the
        // fields the model needs to cite degradation numbers.
        const windows = result.windows.map((w, i) => ({
          windowIndex: i,
          trainStartTime: w.trainStartTime,
          testStartTime: w.testStartTime,
          testEndTime: w.testEndTime,
          embargoBars: w.embargoBars ?? null,
          purgedTrainEventsCount: w.purgedTrainEventsCount ?? null,
          frozenHypothesesCount: w.frozenHypotheses?.length ?? 0,
          trainResults: w.trainResults.map((r) => ({
            eventType: r.eventType,
            sampleSize: r.sampleSize,
            reachRate2R: r.reachRates.r2,
          })),
          testResults: w.testResults.map((r) => ({
            eventType: r.eventType,
            sampleSize: r.sampleSize,
            reachRate2R: r.reachRates.r2,
          })),
        }));
        const output = clampToolOutput({
          symbol: context.symbol,
          timeframe: context.timeframe,
          horizonCandles: args.horizonCandles,
          embargoBars: args.embargoBars ?? null,
          windowCount: result.windows.length,
          windows,
          stability: result.stability,
          stabilityMarkdown: formatStabilityMarkdown(result.stability),
        });
        return verifiedResult('run_walk_forward', output, started);
      } catch (err) {
        return failedResult('run_walk_forward', err, started);
      }
    },
  } satisfies ToolDefinition<{
    trainCandlesCount: number;
    testCandlesCount: number;
    stepCandlesCount: number;
    horizonCandles: number;
    embargoBars?: number | undefined;
  }>);

  /* -- 9. dataset summary ----------------------------------------- */

  catalogue.place({
    handle: 'dataset_summary',
    caption:
      'Return a compact summary of the bound dataset: symbol, timeframe, candle count, first/last timestamp, and the list of event detectors that produced non-zero event counts. Use this at the start of every run to ground the model in the dataset it is researching.',
    argsShape: z.object({}),
    resourceClass: 'local-cpu',
    effects: 'pure',
    grantLevel: 'auto',
    discoverability: {
      keywords: ['dataset', 'summary', 'overview', 'symbol', 'timeframe'],
      category: 'discovery',
      priority: 10,
    },
    invoke: async () => {
      const started = Date.now();
      const candles = context.candles;
      const first = candles[0];
      const last = candles[candles.length - 1];
      const detectorCounts: Record<string, number> = {};
      for (const det of DETECTABLE_EVENT_TYPES) {
        try {
          detectorCounts[det] = getEvents(context, det).length;
        } catch {
          detectorCounts[det] = -1;
        }
      }
      return verifiedResult(
        'dataset_summary',
        {
          symbol: context.symbol,
          timeframe: context.timeframe,
          candleCount: candles.length,
          firstTimestamp: first ? first.timestamp : null,
          lastTimestamp: last ? last.timestamp : null,
          htfCandles: context.htfCandles
            ? Object.fromEntries(
                Object.entries(context.htfCandles).map(([tf, arr]) => [
                  tf,
                  arr ? arr.length : 0,
                ]),
              )
            : null,
          detectorCounts,
        },
        started,
      );
    },
  } satisfies ToolDefinition<Record<string, never>>);

  return catalogue;

  /* ---------------------------------------------------------------- *
   * Local helpers that close over `context`
   * ---------------------------------------------------------------- */

  /**
   * Build ResearchObservations for a single event type by reusing the same
   * detector+outcome pipeline the universal study uses. Internal only.
   */
  function buildObservations(
    eventType: DetectableEventType,
    horizonCandles: number,
  ) {
    const study = runObservationStudy(context.candles, {
      symbol: context.symbol,
      timeframe: context.timeframe,
      horizonCandles,
      htfCandlesMap: toHtfCandlesMap(context),
    });
    return study.observations.filter((o) => o.event.type === eventType);
  }
}

/* ------------------------------------------------------------------ *
 * Direct-invocation convenience (no LLM required)
 * ------------------------------------------------------------------ */

/**
 * Invoke a single tool by handle deterministically, bypassing the LLM.
 *
 * Useful for testing, for CLIs that want to expose the deterministic surface
 * directly, and for users of `@nemesis-oss/crypto-agent` who want the
 * numerical results without spinning up Ollama.
 */
export async function invokeToolDirect(
  catalogue: ToolkitCatalogue,
  handle: string,
  args: Record<string, unknown>,
): Promise<ToolResult> {
  const def = catalogue.get(handle);
  if (!def) {
    return {
      toolCallId: crypto.randomUUID(),
      name: handle,
      success: false,
      error: `Unknown tool: ${handle}`,
      output: null,
      trustLevel: 'unverified',
      executionTimeMs: 0,
    };
  }
  // Catalogue.place already validated the schema on registration; here we
  // re-parse to coerce defaults and reject malformed args.
  const parsed = def.argsShape.safeParse(args);
  if (!parsed.success) {
    const issues =
      parsed.error && typeof (parsed.error as { issues?: unknown }).issues === 'object'
        ? (parsed.error as { issues: unknown }).issues
        : parsed.error;
    return {
      toolCallId: crypto.randomUUID(),
      name: handle,
      success: false,
      error: `Invalid args: ${JSON.stringify(issues)}`,
      output: null,
      trustLevel: 'unverified',
      executionTimeMs: 0,
    };
  }
  return def.invoke(parsed.data, NOOP_LEASE, NO_CANCEL);
}

/** Re-export for tests that need the noop lease shape. */
export const __NOOP_LEASE = NOOP_LEASE;
