import { Agent, OllamaClient } from '@nemesis-oss/ollama-sdk';
import { BinanceClient, type BinanceClientOptions } from '@nemesis-oss/binance-sdk';
import { createTradingRegistry } from './tools.js';

export interface TradingAgentOptions {
  readonly ollama?: OllamaClient | undefined;
  readonly binance?: BinanceClient | undefined;
  readonly model?: string | undefined;
  readonly maxIterations?: number | undefined;
  readonly think?: boolean | 'low' | 'medium' | 'high' | 'max' | undefined;
}

const SYSTEM_PROMPT =
  'You are a crypto trading assistant with access to Binance market data and order execution. ' +
  '- Use get_price to check current prices and 24h metrics. ' +
  '- Use get_klines to analyse recent price action. ' +
  '- Use get_balance to check available funds. ' +
  '- Use calculate_position_size before placing any trades. ' +
  '- Use place_limit_order to execute trades. ' +
  'Always think step by step. If you need more data before placing an order, fetch it first.';

export const createBinanceClient = (options?: BinanceClientOptions): BinanceClient =>
  new BinanceClient({
    apiKey: options?.apiKey ?? process.env.BINANCE_API_KEY,
    apiSecret: options?.apiSecret ?? process.env.BINANCE_API_SECRET,
    testnet: options?.testnet ?? (process.env.BINANCE_TESTNET !== 'false'),
  });

export const runTradingAgent = async (
  userPrompt: string,
  options: TradingAgentOptions = {}
): Promise<string> => {
  const ollama =
    options.ollama ??
    new OllamaClient({
      baseUrl: process.env.OLLAMA_BASE_URL ?? 'http://localhost:11434',
    });
  const binance = options.binance ?? createBinanceClient();
  const registry = createTradingRegistry(binance);

  const agent = new Agent(ollama, {
    tools: registry,
    maxIterations: options.maxIterations ?? 8,
  });

  const response = await agent.run({
    model: options.model ?? process.env.OLLAMA_MODEL ?? 'gemma4:cloud',
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: userPrompt },
    ],
    // First-class SDK option to trigger reasoning stream traces for Gemma 4
    think: options.think ?? 'high',
    options: {
      temperature: 0.2,
      num_ctx: 32768,
    },
  });

  return response.finalMessage.content || 'No response from agent.';
};
