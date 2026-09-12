import type { Timeframe } from '@nemesis-oss/market-events';
import { type ResearchCandleLoader } from './cli-market-data.js';
import { type ResearchCliOptions } from './cli-report.js';
export type { ResearchCliOptions } from './cli-report.js';
export { buildResearchCliReport, DEFAULT_TIMEFRAMES, DEFAULT_HORIZON_CANDLES } from './cli-report.js';
export declare function runResearchCli(symbol?: string, options?: ResearchCliOptions, loadCandles?: ResearchCandleLoader): Promise<string>;
export declare function parseResearchCliArgs(args: readonly string[]): {
    symbol: string;
    timeframes?: Timeframe[];
    horizonCandles?: number;
    candleCount?: number;
    format?: 'auto' | 'terminal' | 'markdown';
    klineMarket?: import('./kline-market.js').BinanceKlineMarket;
};
//# sourceMappingURL=cli.d.ts.map