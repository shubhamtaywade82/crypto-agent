import { fileURLToPath } from 'node:url';
import { runTradingAgent } from './agent.js';

export * from './types.js';
export * from './config.js';
export * from './tools.js';
export * from './agent.js';

const isDirectRun =
  Boolean(process.argv[1]) &&
  fileURLToPath(import.meta.url) === process.argv[1];

if (isDirectRun) {
  const prompt =
    process.argv.slice(2).join(' ') ||
    'Compare BTCUSDT and ETHUSDT price and volume';
  process.stdout.write(`🤖 Prompt: ${prompt}\n\n`);
  const answer = await runTradingAgent(prompt);
  process.stdout.write(`📊 Agent response:\n${answer}\n`);
}
