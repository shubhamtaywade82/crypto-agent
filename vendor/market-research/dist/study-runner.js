import { createHash } from 'node:crypto';
import { detectFvg, detectSwings, detectStructureBreaks, detectBos, detectChoch, detectMss, detectOrderBlocks, detectLiquiditySweeps, detectDisplacement, detectVsaEvents } from '@nemesis-oss/market-events';
import { evaluateEventOutcome, DEFAULT_OUTCOME_CONFIG } from './outcome-evaluators.js';
import { generateMatchedControls } from './matched-controls.js';
import { calculateWilsonInterval, calculateBootstrapMedianCi, compareAgainstBaseline } from './statistical-significance.js';
import { clusterEventsIntoEpisodes } from './episode-clustering.js';
import { extractContextSnapshot } from './context-features.js';
import { adjustBenjaminiHochberg } from './multiple-testing.js';
import { calculateCausalAtr } from './causal-atr.js';
export { calculateCausalAtr };
export function computeDeterministicHash(input) {
    return createHash('sha256').update(input).digest('hex').slice(0, 16);
}
export function computeDatasetSha256(candles) {
    const hash = createHash('sha256');
    for (const c of candles) {
        hash.update(`${c.timestamp}:${c.open}:${c.high}:${c.low}:${c.close}:${c.volume}|`);
    }
    return hash.digest('hex');
}
function calculateMedian(values) {
    if (values.length === 0)
        return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}
export function createResearchObservations(events, candles, config, htfCandlesMap) {
    const datasetId = events[0] ? `${events[0].symbol}-${events[0].timeframe}` : 'unknown';
    const datasetHash = computeDatasetSha256(candles);
    const outcomeConfigHash = computeDeterministicHash(JSON.stringify(config));
    return events.map(ev => {
        const evalIndex = ev.availableAtIndex;
        const context = extractContextSnapshot(candles, evalIndex, htfCandlesMap);
        const outcome = evaluateEventOutcome(ev, candles, context.atr, config);
        const detectorConfigHash = computeDeterministicHash(`${ev.type}:${ev.symbol}:${ev.timeframe}`);
        const provenance = {
            datasetId, datasetHash, detectorId: ev.type,
            detectorVersion: ev.version ?? '1.0.0',
            detectorConfigHash, outcomeConfigHash, outcomeVersion: '1.0.0'
        };
        return { event: ev, context, outcome, provenance };
    });
}
function buildClusterObservations(episodes, observations, controls) {
    const obsMap = new Map(observations.map(o => [o.event.id, o]));
    const eventClusters = [];
    const baselineClusters = [];
    for (const ep of episodes) {
        const epObs = ep.allEvents.map(e => obsMap.get(e.id)).filter((o) => o !== undefined);
        eventClusters.push({ hits: epObs.filter(o => o.outcome.reached2R).length, trials: epObs.length, clusterId: ep.episodeId });
        const epEventIds = new Set(ep.allEvents.map(e => e.id));
        const epControls = controls.filter(c => epEventIds.has(c.matchedEventId));
        if (epControls.length > 0) {
            baselineClusters.push({ hits: epControls.filter(c => c.outcome.reached2R).length, trials: epControls.length, clusterId: `ctrl-${ep.episodeId}` });
        }
    }
    return { eventClusters, baselineClusters };
}
function evaluateStudyComponent(opts, events, candles) {
    const observations = createResearchObservations(events, candles, opts.config, opts.htfCandlesMap);
    const outcomes = observations.map(o => o.outcome);
    const controls = generateMatchedControls(events, candles, opts.config, { matchTrendRegime: true });
    const episodes = clusterEventsIntoEpisodes(events, { maxCandleGap: 3 });
    const clusterSizes = episodes.map(ep => ep.eventsCount);
    const { eventClusters, baselineClusters } = buildClusterObservations(episodes, observations, controls);
    const result = buildStudyResult({
        meta: opts,
        outcomes,
        controlOutcomes: controls.map(c => c.outcome),
        clusterSizes,
        eventClusters,
        baselineClusters
    });
    return { result, observations, matchRatio: controls.matchRatio };
}
function computeStudyStats(data, sampleSize) {
    const { outcomes, controlOutcomes, clusterSizes } = data;
    const fvg = outcomes.filter((o) => 'fill25' in o);
    const isFvg = fvg.length === sampleSize;
    const hit2 = outcomes.filter(o => o.reached2R).length;
    const mfe = outcomes.map(o => o.mfeAtr.toNumber());
    const baseline = compareAgainstBaseline({
        eventHits: hit2, eventTrials: sampleSize, baselineHits: controlOutcomes.filter(o => o.reached2R).length,
        baselineTrials: controlOutcomes.length, clusterSizes, eventClusters: data.eventClusters, baselineClusters: data.baselineClusters
    });
    const reachRates = { r1: outcomes.filter(o => o.reached1R).length / sampleSize, r2: hit2 / sampleSize, r3: outcomes.filter(o => o.reached3R).length / sampleSize };
    return {
        fvgRates: isFvg ? { r: fvg.filter(o => o.firstTouchBars !== null).length / sampleSize, f25: fvg.filter(o => o.fill25).length / sampleSize, f50: fvg.filter(o => o.fill50).length / sampleSize, f100: fvg.filter(o => o.fill100).length / sampleSize } : null,
        mfe, medianMfeCi: calculateBootstrapMedianCi(mfe), intervalR2: calculateWilsonInterval(hit2, sampleSize),
        reachRates, hitRates: reachRates,
        baseline
    };
}
function buildStudyResult(data) {
    const { meta, outcomes, clusterSizes } = data;
    const sampleSize = outcomes.length;
    if (sampleSize === 0) {
        const zeroRates = { r1: 0, r2: 0, r3: 0 };
        return {
            symbol: meta.symbol, timeframe: meta.timeframe, eventType: meta.eventType, sampleSize: 0,
            retestProbability: null, fill25Rate: null, fill50Rate: null, fullFillRate: null,
            medianMfeAtr: 0, medianMaeAtr: 0, reachRates: zeroRates, hitRates: zeroRates
        };
    }
    const s = computeStudyStats(data, sampleSize);
    return {
        symbol: meta.symbol, timeframe: meta.timeframe, eventType: meta.eventType, sampleSize,
        effectiveSampleSize: s.baseline.effectiveSampleSize, clusterCount: clusterSizes.length,
        retestProbability: s.fvgRates?.r ?? null, fill25Rate: s.fvgRates?.f25 ?? null,
        fill50Rate: s.fvgRates?.f50 ?? null, fullFillRate: s.fvgRates?.f100 ?? null,
        medianMfeAtr: calculateMedian(s.mfe), medianMaeAtr: calculateMedian(outcomes.map(o => o.maeAtr.toNumber())),
        medianMfeAtrCi: s.medianMfeCi, reachRates: s.reachRates, hitRates: s.hitRates,
        confidenceIntervalR2: { lower: s.intervalR2.lower, upper: s.intervalR2.upper },
        baselineComparisonR2: {
            baselineProbability: s.baseline.baselineProbability, uplift: s.baseline.uplift,
            relativeUplift: s.baseline.relativeUplift, oddsRatio: s.baseline.oddsRatio,
            isStatisticallySignificant: s.baseline.isStatisticallySignificant, pValueEstimate: s.baseline.pValueEstimate
        }
    };
}
export function runObservationStudy(candles, options) {
    const config = {
        ...DEFAULT_OUTCOME_CONFIG, horizonCandles: options.horizonCandles ?? 24, ambiguityPolicy: options.ambiguityPolicy ?? 'pessimistic'
    };
    const { symbol, timeframe, htfCandlesMap } = options;
    const swings = detectSwings(candles, { leftBars: 2, rightBars: 2 });
    const allBreaks = detectStructureBreaks(candles, swings, { symbol, timeframe });
    const components = [
        ['fvg', detectFvg(candles, { symbol, timeframe })],
        ['bos', detectBos(candles, swings, { symbol, timeframe })],
        ['choch', detectChoch(candles, swings, { symbol, timeframe })],
        ['mss', detectMss(candles, swings, { symbol, timeframe })],
        ['order_block', detectOrderBlocks(candles, allBreaks, { symbol, timeframe })],
        ['liquidity_sweep', detectLiquiditySweeps(candles, swings, { symbol, timeframe })],
        ['displacement', detectDisplacement(candles, { symbol, timeframe })],
        ['vsa', detectVsaEvents(candles, { symbol, timeframe })]
    ];
    const evals = components.map(([eventType, events]) => evaluateStudyComponent({ symbol, timeframe, eventType, config, htfCandlesMap }, events, candles));
    const matchRatios = new Map(evals.map((e, i) => [components[i][0], e.matchRatio]));
    const { results, multipleTesting } = applyStudyMultipleTesting(evals.map(e => e.result));
    return {
        observations: evals.flatMap(e => e.observations),
        results,
        matchRatios,
        multipleTesting
    };
}
function applyStudyMultipleTesting(results, alpha = 0.05) {
    const tests = results
        .filter(r => r.baselineComparisonR2 !== undefined)
        .map(r => ({ id: r.eventType, description: `${r.eventType} R2 uplift`, pValue: r.baselineComparisonR2.pValueEstimate }));
    const adjusted = adjustBenjaminiHochberg(tests, alpha);
    const adjMap = new Map(adjusted.map(a => [a.id, a]));
    const enriched = results.map(r => {
        const adj = adjMap.get(r.eventType);
        if (!r.baselineComparisonR2 || !adj)
            return r;
        return { ...r, baselineComparisonR2: { ...r.baselineComparisonR2, adjustedPValue: adj.adjustedPValue, isFdrSignificant: adj.isSignificant } };
    });
    return {
        results: enriched,
        multipleTesting: {
            procedure: 'benjamini_hochberg', alpha,
            totalTests: tests.length, significantCount: adjusted.filter(a => a.isSignificant).length
        }
    };
}
export function runUniversalStudy(candles, options) {
    return [...runObservationStudy(candles, options).results];
}
export function runFvgStudy(candles, options) {
    return runUniversalStudy(candles, options).find(r => r.eventType === 'fvg');
}
function determineEvidenceStatus(sampleSize, baseComp) {
    if (sampleSize < 30)
        return 'insufficient_sample';
    if (baseComp?.isFdrSignificant)
        return 'robust';
    if (baseComp?.isStatisticallySignificant && (baseComp.uplift ?? 0) > 0)
        return 'exploratory';
    return 'descriptive_only';
}
export function toResearchResult(studyResult, candleCount, provenance, matchRatio) {
    const baseComp = studyResult.baselineComparisonR2;
    const sample = {
        eventType: studyResult.eventType,
        sampleSize: studyResult.sampleSize,
        effectiveSampleSize: studyResult.effectiveSampleSize ?? studyResult.sampleSize,
        clusterCount: studyResult.clusterCount ?? 1
    };
    return {
        population: { symbol: studyResult.symbol, timeframe: studyResult.timeframe, candleCount },
        sample,
        controls: { sampleSize: studyResult.sampleSize, matchedHitRateR2: baseComp?.baselineProbability ?? 0, matchRatio: matchRatio ?? 0 },
        descriptive: {
            reachRates: studyResult.reachRates,
            hitRates: studyResult.hitRates,
            medianMfeAtr: studyResult.medianMfeAtr, medianMaeAtr: studyResult.medianMaeAtr,
            retestProbability: studyResult.retestProbability, fill25Rate: studyResult.fill25Rate,
            fill50Rate: studyResult.fill50Rate, fullFillRate: studyResult.fullFillRate
        },
        effect: { uplift: baseComp?.uplift ?? 0, relativeUplift: baseComp?.relativeUplift, oddsRatio: baseComp?.oddsRatio },
        uncertainty: { confidenceIntervalR2: studyResult.confidenceIntervalR2, medianMfeAtrCi: studyResult.medianMfeAtrCi },
        dependence: {
            clusterCount: sample.clusterCount, effectiveSampleSize: sample.effectiveSampleSize,
            pValueEstimate: baseComp?.pValueEstimate ?? 1, isStatisticallySignificant: baseComp?.isStatisticallySignificant ?? false,
            adjustedPValue: baseComp?.adjustedPValue, isFdrSignificant: baseComp?.isFdrSignificant
        },
        provenance,
        evidenceStatus: determineEvidenceStatus(sample.sampleSize, baseComp)
    };
}
//# sourceMappingURL=study-runner.js.map