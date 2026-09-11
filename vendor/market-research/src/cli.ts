import { Decimal } from 'decimal.js';
import type { Candle, Timeframe } from '@nemesis-oss/market-events';
import { runUniversalStudy } from './study-runner.js';
import { buildEffectivenessMatrix, formatMatrixMarkdown } from './matrix-report.js';
import { runWalkForwardValidation, formatStabilityMarkdown } from './walk-forward.js';

function generateRealisticCandles(count: number, basePrice: number = 60000): Candle[] {
  const candles: Candle[] = [];
  let currentPrice = new Decimal(basePrice);
  const startTs = Date.now() - count * 15 * 60 * 1000;

  for (let i = 0; i < count; i++) {
    // Multi-cycle trending and pulling-back waves designed to generate structural breaks and order blocks
    const cycle = i % 40;
    let step = 0;

    if (cycle < 10) step = 15;        // initial climb
    else if (cycle < 16) step = -20;   // retracement establishing swing high
    else if (cycle < 26) step = 30;    // powerful expansion breaking the swing high (BOS + OB)
    else if (cycle < 32) step = -15;   // pullback
    else step = 10;                    // continuation

    const deltaDec = new Decimal(step * 4);
    const open = currentPrice;
    const close = open.plus(deltaDec);
    const wickHigh = step > 0 ? 25 : 10;
    const wickLow = step < 0 ? 25 : 10;
    const high = Decimal.max(open, close).plus(wickHigh);
    const low = Decimal.min(open, close).minus(wickLow);
    const volume = new Decimal(100 + Math.abs(step) * 10);

    candles.push({
      timestamp: startTs + i * 15 * 60 * 1000,
      open,
      high,
      low,
      close,
      volume
    });

    currentPrice = close;
  }

  return candles;
}

/**
 * Main execution function for running research studies across all components and timeframes.
 */
export function runResearchCli(symbol: string = 'BTCUSDT'): string {
  const timeframes: Timeframe[] = ['5m', '15m', '1h', '4h'];
  const sampleCandles = generateRealisticCandles(320, 65000);

  const allStudies = timeframes.flatMap(tf => {
    return runUniversalStudy(sampleCandles, {
      symbol,
      timeframe: tf,
      horizonCandles: 24
    });
  });

  const matrix = buildEffectivenessMatrix(symbol, allStudies);
  const matrixMd = formatMatrixMarkdown(matrix, timeframes);

  const wfResult = runWalkForwardValidation(sampleCandles, {
    symbol,
    timeframe: '15m',
    trainCandlesCount: 160,
    testCandlesCount: 80,
    stepCandlesCount: 40,
    horizonCandles: 24
  });
  const stabilityMd = formatStabilityMarkdown(wfResult.stability);

  return `${matrixMd}\n\n${stabilityMd}`;
}

function parseSymbolArg(args: readonly string[]): string {
  const symIdx = args.indexOf('--symbol');
  if (symIdx !== -1 && args[symIdx + 1] && !args[symIdx + 1]!.startsWith('-')) {
    return args[symIdx + 1]!;
  }
  const firstNonFlag = args.find(a => !a.startsWith('-'));
  return firstNonFlag ?? 'BTCUSDT';
}

const isMainModule = process.argv[1] && (process.argv[1].endsWith('cli.js') || process.argv[1].endsWith('cli.ts'));
if (isMainModule) {
  const symbol = parseSymbolArg(process.argv.slice(2));
  const output = runResearchCli(symbol);
  process.stdout.write(`${output}\n`);
}
