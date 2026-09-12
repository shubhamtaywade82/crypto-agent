import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_RESEARCH_CANDLE_COUNT, fetchBinanceCandlesByTimeframe } from './cli-market-data.js';
import { resolveResearchKlineMarket } from './kline-market.js';
import { buildResearchCliReport, DEFAULT_TIMEFRAMES } from './cli-report.js';
export { buildResearchCliReport, DEFAULT_TIMEFRAMES, DEFAULT_HORIZON_CANDLES } from './cli-report.js';
const VALID_TIMEFRAMES = new Set([
    '1m', '3m', '5m', '15m', '30m', '1h', '2h', '4h', '6h', '8h', '12h', '1d', '1w', '1M'
]);
export async function runResearchCli(symbol = 'ETHUSDT', options = {}, loadCandles) {
    const timeframes = options.timeframes ?? DEFAULT_TIMEFRAMES;
    const candleCount = options.candleCount ?? DEFAULT_RESEARCH_CANDLE_COUNT;
    const marketOptions = {
        candleCount,
        klineMarket: options.klineMarket ?? resolveResearchKlineMarket(),
        ...(options.endTime !== undefined ? { endTime: options.endTime } : {})
    };
    const candlesByTimeframe = await fetchBinanceCandlesByTimeframe(symbol, timeframes, marketOptions, loadCandles);
    const reportOptions = { timeframes, candleCount };
    if (options.horizonCandles !== undefined)
        reportOptions.horizonCandles = options.horizonCandles;
    if (options.endTime !== undefined)
        reportOptions.endTime = options.endTime;
    if (options.format !== undefined)
        reportOptions.format = options.format;
    return buildResearchCliReport(symbol, candlesByTimeframe, reportOptions);
}
function readFlagValue(args, flag) {
    const idx = args.indexOf(flag);
    if (idx === -1)
        return undefined;
    const value = args[idx + 1];
    if (!value || value.startsWith('-'))
        return undefined;
    return value;
}
function parseTimeframesArg(args) {
    const raw = readFlagValue(args, '--timeframes');
    if (!raw)
        return undefined;
    const parsed = raw.split(',').map(part => part.trim()).filter(Boolean);
    const invalid = parsed.filter(tf => !VALID_TIMEFRAMES.has(tf));
    if (invalid.length > 0) {
        throw new Error(`Invalid timeframe(s): ${invalid.join(', ')}`);
    }
    return parsed;
}
function parseHorizonArg(args) {
    const raw = readFlagValue(args, '--horizon');
    if (!raw)
        return undefined;
    const horizon = Number.parseInt(raw, 10);
    if (!Number.isFinite(horizon) || horizon <= 0) {
        throw new Error(`Invalid --horizon value: ${raw}`);
    }
    return horizon;
}
function parseLookbackArg(args) {
    const raw = readFlagValue(args, '--lookback');
    if (!raw)
        return undefined;
    const lookback = Number.parseInt(raw, 10);
    if (!Number.isFinite(lookback) || lookback <= 0) {
        throw new Error(`Invalid --lookback value: ${raw}`);
    }
    return lookback;
}
function parseSymbolArg(args) {
    const fromFlag = readFlagValue(args, '--symbol');
    if (fromFlag)
        return fromFlag;
    const firstNonFlag = args.find(a => !a.startsWith('-'));
    return firstNonFlag ?? 'ETHUSDT';
}
function parseFormatArg(args) {
    if (args.includes('--markdown'))
        return 'markdown';
    if (args.includes('--terminal'))
        return 'terminal';
    const raw = readFlagValue(args, '--format');
    if (raw === 'markdown' || raw === 'terminal' || raw === 'auto')
        return raw;
    return undefined;
}
function parseMarketArg(args) {
    const raw = readFlagValue(args, '--market');
    return raw !== undefined ? resolveResearchKlineMarket(raw) : undefined;
}
export function parseResearchCliArgs(args) {
    const timeframes = parseTimeframesArg(args);
    const horizonCandles = parseHorizonArg(args);
    const candleCount = parseLookbackArg(args);
    const format = parseFormatArg(args);
    const klineMarket = parseMarketArg(args);
    return {
        symbol: parseSymbolArg(args),
        ...(timeframes !== undefined ? { timeframes } : {}),
        ...(horizonCandles !== undefined ? { horizonCandles } : {}),
        ...(candleCount !== undefined ? { candleCount } : {}),
        ...(format !== undefined ? { format } : {}),
        ...(klineMarket !== undefined ? { klineMarket } : {})
    };
}
const isMainModule = () => {
    const entry = process.argv[1];
    if (!entry)
        return false;
    return fileURLToPath(import.meta.url) === path.resolve(entry);
};
async function runCliMain() {
    const cliArgs = process.argv.slice(2).filter(arg => arg !== '--');
    const parsed = parseResearchCliArgs(cliArgs);
    const { symbol, timeframes, horizonCandles, candleCount, format, klineMarket } = parsed;
    const options = {};
    if (timeframes !== undefined)
        options.timeframes = timeframes;
    if (horizonCandles !== undefined)
        options.horizonCandles = horizonCandles;
    if (candleCount !== undefined)
        options.candleCount = candleCount;
    if (format !== undefined)
        options.format = format;
    const output = await runResearchCli(symbol, {
        ...options,
        ...(klineMarket !== undefined ? { klineMarket } : {}),
    });
    process.stdout.write(`${output}\n`);
}
if (isMainModule()) {
    runCliMain().catch(err => {
        const message = err instanceof Error ? err.message : String(err);
        process.stderr.write(`market-research cli: ${message}\n`);
        process.exitCode = 1;
    });
}
//# sourceMappingURL=cli.js.map