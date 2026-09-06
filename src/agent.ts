import { Agent, OllamaClient } from '@nemesis-oss/ollama-sdk';
import type { BinanceClient } from '@nemesis-oss/binance-sdk';
import { binanceClient, defaultModel, ollamaClient } from './config.js';
import { createTradingRegistry } from './tools.js';

export interface TradingAgentOptions {
  readonly ollama?: OllamaClient | undefined;
  readonly binance?: BinanceClient | undefined;
  readonly model?: string | undefined;
  readonly maxIterations?: number | undefined;
  readonly think?: boolean | 'low' | 'medium' | 'high' | 'max' | undefined;
  readonly tools?: readonly string[] | undefined;
}

const SYSTEM_PROMPT =
  'You are a crypto market analyst and execution assistant with direct access to Binance market data. ' +
  '- Use spot_ticker_price or spot_ticker_24hr for current market stats. ' +
  '- Use spot_klines for OHLCV candlestick trend analysis. ' +
  '- Use spot_order_book for liquidity and depth. ' +
  '- Use spot_account to inspect balances when API keys are configured. ' +
  '- Use paper_broker_get_positions and paper_broker_place_order for simulated paper trading. ' +
  '- Use calculate_position_size to compute precise risk-adjusted lot sizes. ' +
  'Always reason step-by-step and verify data before executing trades.';

export const runTradingAgent = async (
  userPrompt: string,
  options: TradingAgentOptions = {}
): Promise<string> => {
  const ollama = options.ollama ?? ollamaClient;
  const binance = options.binance ?? binanceClient;
  const registry = createTradingRegistry(binance, options.tools);

  const agent = new Agent(ollama, {
    tools: registry,
    maxIterations: options.maxIterations ?? 8,
  });

  const response = await agent.run({
    model: options.model ?? defaultModel,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: userPrompt },
    ],
    // Passes reasoning flag directly to SDK turn loop
    think: options.think ?? 'high',
    options: {
      temperature: 0.2,
      num_ctx: 32768,
      num_batch: 512,
      num_gpu: 999,
      use_mlock: true,
      num_predict: 1024,
    },
  });

  return response.finalMessage.content || 'No response from agent.';
};

export const runAgent = runTradingAgent;
