import type { Timeframe } from '@nemesis-oss/market-events';
import type { ExchangeAdapter } from '@nemesis-oss/market-data';

import { createResearchAgent, type ResearchAgent, type ResearchAgentOptions } from './agent.js';
import type { ResearchContext } from './context.js';

/**
 * Options for {@link createResearchAgentFromExchange}.
 */
export interface ResearchAgentFromExchangeOptions {
  /** Exchange adapter (Binance, Bybit, etc.). */
  readonly adapter: ExchangeAdapter;
  /** Trading pair, exchange-native format. */
  readonly symbol: string;
  /** Timeframe of the primary working dataset. */
  readonly timeframe: Timeframe;
  /** Inclusive start of historical window, ms since epoch. */
  readonly startTime: number;
  /** Exclusive end of historical window, ms since epoch. */
  readonly endTime: number;
  /** Optional HTF candles, fetched from the same adapter. */
  readonly htfTimeframes?: readonly Timeframe[] | undefined;
  /** Agent construction options (model, budgets, etc.). */
  readonly agentOptions?: ResearchAgentOptions | undefined;
  /** Optional abort signal for the fetch phase. */
  readonly signal?: AbortSignal | undefined;
  /**
   * Override the default batch size for kline pagination. Most exchanges
   * cap at 1000–1500 per request.
   */
  readonly batchLimit?: number | undefined;
}

export type BuildResearchContextFromExchangeOptions = Omit<
  ResearchAgentFromExchangeOptions,
  'agentOptions'
>;

export async function buildResearchContextFromExchange(
  options: BuildResearchContextFromExchangeOptions,
): Promise<ResearchContext> {
  const { adapter, symbol, timeframe, startTime, endTime, htfTimeframes, signal, batchLimit } = options;

  const candles = await adapter.fetchKlines({
    symbol,
    timeframe,
    startTime,
    endTime,
    ...(batchLimit !== undefined ? { batchLimit } : {}),
    ...(signal !== undefined ? { signal } : {}),
  });

  if (candles.length === 0) {
    throw new Error(
      `No candles returned from ${adapter.exchange} for ${symbol} ${timeframe} in [${startTime}, ${endTime})`,
    );
  }

  let htfCandles: ResearchContext['htfCandles'] | undefined;
  if (htfTimeframes && htfTimeframes.length > 0) {
    const entries = await Promise.all(
      htfTimeframes.map(async (tf) => {
        const htf = await adapter.fetchKlines({
          symbol,
          timeframe: tf,
          startTime,
          endTime,
          ...(batchLimit !== undefined ? { batchLimit } : {}),
          ...(signal !== undefined ? { signal } : {}),
        });
        return [tf, htf] as const;
      }),
    );
    htfCandles = Object.fromEntries(entries) as ResearchContext['htfCandles'];
  }

  return {
    symbol,
    timeframe,
    candles,
    ...(htfCandles !== undefined ? { htfCandles } : {}),
  };
}

/**
 * Construct a {@link ResearchAgent} bound to historical candles fetched
 * directly from an exchange adapter. Convenience wrapper that:
 *
 *  1. Fetches the primary timeframe candles via `adapter.fetchKlines`.
 *  2. Optionally fetches higher-timeframe candles for HTF-conflict analysis.
 *  3. Constructs a {@link ResearchContext} and returns a fully-wired agent.
 *
 * The adapter itself is not retained — once the candles are fetched and
 * bound to the context, the agent is fully deterministic. Live updates are
 * a separate concern (use the adapter's `subscribeKlines` for that).
 *
 * @example
 * ```ts
 * import { createBinanceAdapter } from '@nemesis-oss/market-data';
 * import { createResearchAgentFromExchange } from '@nemesis-oss/market-research-agent';
 *
 * const agent = await createResearchAgentFromExchange({
 *   adapter: createBinanceAdapter(),
 *   symbol: 'ETHUSDT',
 *   timeframe: '15m',
 *   startTime: Date.now() - 30 * 24 * 60 * 60 * 1000,  // 30 days
 *   endTime: Date.now(),
 *   htfTimeframes: ['1h', '4h'],
 * });
 *
 * const result = await agent.research(
 *   'Does bullish FVG continuation on ETHUSDT 15m provide statistically significant 2R edge?',
 * );
 * console.log(result.report);
 * ```
 */
export async function createResearchAgentFromExchange(
  options: ResearchAgentFromExchangeOptions,
): Promise<ResearchAgent> {
  const { agentOptions, ...fetchOptions } = options;
  const context = await buildResearchContextFromExchange(fetchOptions);
  return createResearchAgent(context, agentOptions);
}
