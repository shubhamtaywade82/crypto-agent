import { OllamaClient } from '@nemesis-oss/ollama-sdk';
import { BinanceClient } from '@nemesis-oss/binance-sdk';
import 'dotenv/config';

/** Binance serves market data only; these variables must stay unset. */
const BINANCE_CREDENTIAL_VARS = ['BINANCE_API_KEY', 'BINANCE_API_SECRET'] as const;

/**
 * Startup guard. A credential in the environment makes a signed-capable Binance
 * client possible, which the architecture forbids: execution and account data
 * are CoinDCX-only. Empty values count as unset.
 */
export const assertPublicBinanceOnly = (env: NodeJS.ProcessEnv): void => {
  const present = BINANCE_CREDENTIAL_VARS.filter((name) => (env[name] ?? '') !== '');
  if (present.length === 0) return;
  throw new Error(
    `Binance credentials are not permitted (${present.join(', ')} set): ` +
    'Binance is public market data only; execution and account data run on CoinDCX.'
  );
};

/**
 * Public Binance spot tools: market data, no key, no signature. The tool
 * registry and the MCP bridge both refuse anything outside this list.
 */
export const PUBLIC_BINANCE_TOOL_NAMES: readonly string[] = [
  'spot_ping',
  'spot_server_time',
  'spot_exchange_info',
  'spot_ticker_price',
  'spot_ticker_24hr',
  'spot_book_ticker',
  'spot_order_book',
  'spot_recent_trades',
  'spot_klines',
  'spot_avg_price',
];

export const isPublicBinanceTool = (name: string): boolean =>
  PUBLIC_BINANCE_TOOL_NAMES.includes(name);

assertPublicBinanceOnly(process.env);

export const ollamaClient = new OllamaClient({
  baseUrl: process.env.OLLAMA_BASE_URL ?? 'http://localhost:11434',
});

/** Public market-data client, built without credentials so no signed endpoint can authenticate through it. */
export const binanceClient = new BinanceClient({ testnet: false });

export const defaultModel = process.env.OLLAMA_MODEL ?? 'gemma4:cloud';
export const defaultMaxNotional = process.env.MAX_POSITION_NOTIONAL_USDT ?? '5000';
