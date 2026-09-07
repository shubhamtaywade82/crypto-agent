import { OllamaClient } from '@nemesis-oss/ollama-sdk';
import { BinanceClient } from '@nemesis-oss/binance-sdk';
import 'dotenv/config';

export const ollamaClient = new OllamaClient({
  baseUrl: process.env.OLLAMA_BASE_URL ?? 'http://localhost:11434',
});

export const binanceClient = new BinanceClient({
  apiKey: process.env.BINANCE_API_KEY,
  apiSecret: process.env.BINANCE_API_SECRET,
  testnet: false,
});

export const defaultModel = process.env.OLLAMA_MODEL ?? 'gemma4:cloud';
export const defaultMaxNotional = process.env.MAX_POSITION_NOTIONAL_USDT ?? '5000';
