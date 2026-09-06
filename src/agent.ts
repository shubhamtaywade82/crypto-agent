import {
  OllamaClient,
  type AgentHooks,
  type Message,
  type ToolCall,
  type ToolDefinition,
  type ToolExecutionResult,
  type ToolRegistry,
} from '@nemesis-oss/ollama-sdk';
import type { BinanceClient } from '@nemesis-oss/binance-sdk';
import type { WatchOrchestrator } from './engine/orchestrator.js';
import { binanceClient, defaultModel, ollamaClient } from './config.js';
import { createTradingRegistry } from './tools.js';

export interface TradingAgentOptions {
  readonly ollama?: OllamaClient | undefined;
  readonly binance?: BinanceClient | undefined;
  readonly model?: string | undefined;
  readonly maxIterations?: number | undefined;
  readonly think?: boolean | 'low' | 'medium' | 'high' | 'max' | undefined;
  readonly tools?: readonly string[] | undefined;
  readonly hooks?: AgentHooks | undefined;
  readonly orchestrator?: WatchOrchestrator | undefined;
}

const SYSTEM_PROMPT =
  'You are a crypto market analyst and execution assistant with direct access to public Binance market data. ' +
  '- Use spot_ticker_price or spot_ticker_24hr for current market stats. ' +
  '- Use spot_klines for OHLCV candlestick trend analysis. ' +
  '- Use spot_order_book for liquidity and depth. ' +
  '- Use paper_broker_get_positions and paper_broker_place_order for simulated paper trading. ' +
  '- Use calculate_position_size to compute precise risk-adjusted lot sizes. ' +
  '- Use register_price_watch to set up live WebSocket price alerts that auto-trigger re-analysis and Telegram notifications. ' +
  '- Use list_active_watches to check currently active price watches. ' +
  '- Use remove_price_watch to cancel a watch by its ID. ' +
  'AUTONOMOUS PRICE WATCH RULES: ' +
  'When the user asks to watch or track a coin (even without specific prices), NEVER ask questions or request technical parameters. ' +
  'Immediately fetch current price and klines, determine the key breakout and breakdown levels, and call register_price_watch automatically. ' +
  'If the user specifies a target price, compare it against the current price to set type (price_above or price_below) automatically. ' +
  'All Binance access is public market data only (no private keys required). ' +
  'Always reason step-by-step and verify data before executing trades.';

interface StreamTurnOptions {
  readonly ollama: OllamaClient;
  readonly model: string;
  readonly history: Message[];
  readonly toolDefs: readonly ToolDefinition[] | undefined;
  readonly think: boolean | 'low' | 'medium' | 'high' | 'max';
  readonly hooks?: AgentHooks | undefined;
}

const streamSingleTurn = async (opts: StreamTurnOptions): Promise<Message> => {
  const response = await opts.ollama.chat({
    model: opts.model,
    messages: opts.history,
    ...(opts.toolDefs && opts.toolDefs.length > 0 ? { tools: opts.toolDefs } : {}),
    think: opts.think,
    stream: true,
    options: {
      temperature: 0.2,
      num_ctx: 32768,
      num_batch: 512,
      num_gpu: 999,
      use_mlock: true,
      num_predict: 4096,
    },
  });

  if ('finalResult' in response) {
    for await (const event of response) {
      if (event.type === 'token') opts.hooks?.onToken?.(event.data.delta);
      else if (event.type === 'thinking') opts.hooks?.onThinking?.(event.data.delta);
    }
    const final = await response.finalResult;
    return final.message;
  }
  return (response as unknown as { message: Message }).message;
};

const executeToolCallsStep = async (
  registry: ToolRegistry,
  toolCalls: readonly ToolCall[],
  history: Message[],
  hooks?: AgentHooks
): Promise<ToolExecutionResult[]> => {
  for (const call of toolCalls) hooks?.onToolCallStart?.(call);
  const results = await registry.executeToolCalls(toolCalls);
  for (const res of results) {
    hooks?.onToolCallEnd?.(res);
    history.push({
      role: 'tool',
      ...(res.toolCallId !== undefined ? { tool_call_id: res.toolCallId } : {}),
      content: res.outputString,
    });
  }
  return results;
};

const executeReActLoop = async (
  ollama: OllamaClient,
  registry: ToolRegistry,
  options: TradingAgentOptions,
  messages: Message[]
): Promise<string> => {
  const history = [...messages];
  const maxIterations = options.maxIterations ?? 15;
  const toolDefs = registry.definitions();

  for (let iteration = 1; iteration <= maxIterations; iteration++) {
    options.hooks?.onTurnStart?.(iteration);
    const assistantMessage = await streamSingleTurn({
      ollama,
      model: options.model ?? defaultModel,
      history,
      toolDefs: toolDefs.length > 0 ? toolDefs : undefined,
      think: options.think ?? 'high',
      hooks: options.hooks,
    });

    history.push(assistantMessage);
    const toolCalls = assistantMessage.tool_calls;

    if (!toolCalls || toolCalls.length === 0) {
      options.hooks?.onTurnEnd?.({ iteration, message: assistantMessage });
      return assistantMessage.content || 'No response from agent.';
    }

    const results = await executeToolCallsStep(registry, toolCalls, history, options.hooks);
    options.hooks?.onTurnEnd?.({ iteration, message: assistantMessage, toolCalls, toolResults: results });
  }

  return 'Agent reached maximum iterations without converging.';
};

export const runTradingAgent = async (
  userPrompt: string,
  options: TradingAgentOptions = {}
): Promise<string> => {
  const ollama = options.ollama ?? ollamaClient;
  const binance = options.binance ?? binanceClient;
  const registry = createTradingRegistry(binance, options.tools, options.orchestrator);

  return executeReActLoop(ollama, registry, options, [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: userPrompt },
  ]);
};

export const runAgent = runTradingAgent;
