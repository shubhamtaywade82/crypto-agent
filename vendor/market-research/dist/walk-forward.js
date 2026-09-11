import { Decimal } from 'decimal.js';
import { detectFvg, detectSwings, detectStructureBreaks, detectOrderBlocks, detectLiquiditySweeps } from '@nemesis-oss/market-events';
import { calculateCausalAtr } from './causal-atr.js';
import { evaluateEventOutcome, DEFAULT_OUTCOME_CONFIG } from './outcome-evaluators.js';
function isTrendAligned(ev, candles) {
    const start = Math.max(0, ev.originIndex - 19);
    const slice = candles.slice(start, ev.originIndex + 1);
    if (slice.length === 0)
        return true;
    const sum = slice.reduce((acc, c) => acc.plus(c.close), new Decimal(0));
    const ma = sum.dividedBy(slice.length);
    const c = candles[ev.originIndex];
    return c ? (ev.direction === 'bullish' ? c.close.gte(ma) : c.close.lte(ma)) : true;
}
const CANDIDATE_RULES = [
    { id: 'baseline', desc: 'All events', predicate: () => true },
    {
        id: 'min_size_1atr',
        desc: 'Size >= 1.0 ATR',
        predicate: (ev, _, atr) => ('size' in ev ? ev.size.gte(atr) : true)
    },
    { id: 'trend_aligned', desc: 'Aligned with 20-bar trend', predicate: isTrendAligned }
];
function detectEventsByType(type, candles, options) {
    const { symbol, timeframe } = options;
    if (type === 'fvg')
        return detectFvg(candles, { symbol, timeframe });
    const swings = detectSwings(candles, { leftBars: 2, rightBars: 2 });
    if (type === 'bos')
        return detectStructureBreaks(candles, swings, { symbol, timeframe }).filter(b => b.type === 'bos');
    if (type === 'liquidity_sweep')
        return detectLiquiditySweeps(candles, swings, { symbol, timeframe });
    if (type === 'order_block') {
        const breaks = detectStructureBreaks(candles, swings, { symbol, timeframe });
        return detectOrderBlocks(candles, breaks, { symbol, timeframe });
    }
    return [];
}
function evaluateRulePerformance(rule, items, candles) {
    const matching = items.filter(({ e, atr }) => rule.predicate(e, candles, atr));
    if (matching.length < 2)
        return { rate: -1, count: matching.length };
    const hits = matching.filter(m => m.outcome.reached2R).length;
    return { rate: hits / matching.length, count: matching.length };
}
function discoverBestHypothesis(events, candles, config) {
    const atrs = events.map(e => calculateCausalAtr(candles, e.originIndex));
    const items = events.map((e, i) => ({ e, outcome: evaluateEventOutcome(e, candles, atrs[i], config), atr: atrs[i] }));
    let best = { rule: CANDIDATE_RULES[0], rate: -1, count: items.length };
    for (const rule of CANDIDATE_RULES) {
        const perf = evaluateRulePerformance(rule, items, candles);
        if (perf.rate > best.rate)
            best = { rule, rate: perf.rate, count: perf.count };
    }
    const defaultRate = items.length > 0 ? items.filter(m => m.outcome.reached2R).length / items.length : 0;
    return { bestRule: best.rule, trainHitRate: best.rate >= 0 ? best.rate : defaultRate, trainSample: best.count };
}
function buildSimpleStudyResult(symbol, timeframe, eventType, sampleSize, hitRateR2) {
    const rates = { r1: hitRateR2, r2: hitRateR2, r3: 0 };
    return {
        symbol, timeframe, eventType, sampleSize,
        retestProbability: null, fill25Rate: null, fill50Rate: null, fullFillRate: null,
        medianMfeAtr: 0, medianMaeAtr: 0, reachRates: rates, hitRates: rates
    };
}
function evaluateComponentWithHypothesis(type, trainCandles, testCandles, options) {
    const { symbol, timeframe, config, purgeHorizon = 0, testStartTime } = options;
    const rawTrain = detectEventsByType(type, trainCandles, { symbol, timeframe });
    // Interval purge: forbid events whose outcome label extends beyond train boundary
    const trainEvents = purgeHorizon > 0
        ? rawTrain.filter(e => (e.availableAtIndex ?? e.originIndex) + purgeHorizon < trainCandles.length)
        : rawTrain;
    const { bestRule, trainHitRate, trainSample } = discoverBestHypothesis(trainEvents, trainCandles, config);
    const frozen = {
        component: type, hypothesisId: bestRule.id, hypothesisDescription: bestRule.desc,
        trainSampleSize: trainSample, trainHitRateR2: trainHitRate
    };
    const rawTest = detectEventsByType(type, testCandles, { symbol, timeframe });
    const testEvents = testStartTime !== undefined ? rawTest.filter(e => e.originTimestamp >= testStartTime) : rawTest;
    const testAtrs = testEvents.map(e => calculateCausalAtr(testCandles, e.originIndex));
    const filteredTest = testEvents.filter((e, i) => bestRule.predicate(e, testCandles, testAtrs[i]));
    const testHits = filteredTest.filter(e => evaluateEventOutcome(e, testCandles, calculateCausalAtr(testCandles, e.originIndex), config).reached2R).length;
    const testHitRate = filteredTest.length > 0 ? testHits / filteredTest.length : 0;
    return {
        frozen,
        trainResult: buildSimpleStudyResult(symbol, timeframe, type, trainSample, trainHitRate),
        testResult: buildSimpleStudyResult(symbol, timeframe, type, filteredTest.length, testHitRate),
        purgedCount: rawTrain.length - trainEvents.length
    };
}
function computeStabilitySummary(windows, components) {
    return components.map(comp => {
        let sumTrain = 0, sumTest = 0, count = 0;
        for (const w of windows) {
            const tr = w.trainResults.find(r => r.eventType === comp);
            const te = w.testResults.find(r => r.eventType === comp);
            if (tr && te && tr.sampleSize > 0 && te.sampleSize > 0) {
                sumTrain += tr.reachRates.r2;
                sumTest += te.reachRates.r2;
                count++;
            }
        }
        const meanTrain = count > 0 ? sumTrain / count : 0;
        const meanTest = count > 0 ? sumTest / count : 0;
        const degradation = meanTrain - meanTest;
        return {
            component: comp, windowsCount: count,
            meanTrainHitRateR2: meanTrain, meanTestHitRateR2: meanTest,
            hitRateDegradation: degradation, isStable: count > 0 && degradation < 0.15
        };
    });
}
function evaluateWindowComponents(trainSlice, testSlice, components, options) {
    const frozenList = [];
    const trainResults = [];
    const testResults = [];
    let purgedCount = 0;
    for (const comp of components) {
        const res = evaluateComponentWithHypothesis(comp, trainSlice, testSlice, {
            ...options, purgeHorizon: options.config.horizonCandles
        });
        frozenList.push(res.frozen);
        trainResults.push(res.trainResult);
        testResults.push(res.testResult);
        purgedCount += res.purgedCount;
    }
    return { frozenList, trainResults, testResults, purgedCount };
}
function buildWalkForwardWindow(candles, startIdx, windowIdx, components, options, config) {
    const { trainCandlesCount, testCandlesCount, symbol, timeframe } = options;
    const embargoBars = options.embargoBars ?? config.horizonCandles;
    const trainSlice = candles.slice(startIdx, startIdx + trainCandlesCount);
    const testStart = startIdx + trainCandlesCount + embargoBars;
    const warmup = options.warmupBars ?? Math.min(testStart, 50);
    const testSlice = candles.slice(testStart - warmup, testStart + testCandlesCount);
    const testStartTime = candles[testStart].timestamp;
    const evalRes = evaluateWindowComponents(trainSlice, testSlice, components, { symbol, timeframe, config, testStartTime });
    return {
        windowIndex: windowIdx,
        trainStartTime: trainSlice[0].timestamp,
        trainEndTime: trainSlice[trainSlice.length - 1].timestamp,
        testStartTime,
        testEndTime: testSlice[testSlice.length - 1].timestamp,
        embargoBars,
        purgedTrainEventsCount: evalRes.purgedCount,
        frozenHypotheses: evalRes.frozenList,
        trainResults: evalRes.trainResults,
        testResults: evalRes.testResults
    };
}
/**
 * Runs walk-forward out-of-sample validation:
 * Discovers best hypothesis on purged training window, freezes it,
 * and evaluates out-of-sample on unseen test window with continuous warmup state.
 */
export function runWalkForwardValidation(candles, options) {
    const { trainCandlesCount, testCandlesCount, stepCandlesCount, horizonCandles } = options;
    const config = { ...DEFAULT_OUTCOME_CONFIG, ...(horizonCandles ? { horizonCandles } : {}) };
    const embargoBars = options.embargoBars ?? config.horizonCandles;
    const windows = [];
    const components = ['fvg', 'bos', 'order_block', 'liquidity_sweep'];
    let startIdx = 0;
    while (startIdx + trainCandlesCount + embargoBars + testCandlesCount <= candles.length) {
        windows.push(buildWalkForwardWindow(candles, startIdx, windows.length, components, options, config));
        startIdx += stepCandlesCount;
    }
    return { windows, stability: computeStabilitySummary(windows, components) };
}
/**
 * Formats WalkForward stability summary as a clean markdown table.
 */
export function formatStabilityMarkdown(stability) {
    const rows = stability.map(s => {
        const train = (s.meanTrainHitRateR2 * 100).toFixed(1);
        const test = (s.meanTestHitRateR2 * 100).toFixed(1);
        const deg = (s.hitRateDegradation * 100).toFixed(1);
        return `| ${s.component.toUpperCase()} | ${s.windowsCount} | ${train}% | ${test}% | ${deg}pp | ${s.isStable ? 'STABLE' : 'DEGRADED'} |`;
    });
    return [
        '## Walk-Forward Stability (Out-of-Sample)',
        '| Component | Windows | Train Hit Rate (+2R) | Test Hit Rate (+2R) | Degradation | Status |',
        '| :--- | :---: | :---: | :---: | :---: | :---: |',
        ...rows
    ].join('\n');
}
//# sourceMappingURL=walk-forward.js.map