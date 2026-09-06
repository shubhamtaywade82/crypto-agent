import 'dotenv/config';
import * as readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { runTradingAgent } from './agent.js';

import type { AgentHooks } from '@nemesis-oss/ollama-sdk';

const formatPreview = (val: unknown): string =>
  (typeof val === 'object' ? JSON.stringify(val) : String(val)).slice(0, 80);

const createCliHooks = (): AgentHooks => {
  let isThinking = false;
  let isFirstToken = true;

  const resetThinking = (): void => {
    if (isThinking) {
      process.stdout.write('\x1b[0m\n');
      isThinking = false;
    }
  };

  return {
    onThinking: (chunk: string): void => {
      if (!isThinking) {
        process.stdout.write('\n🧠 Thought:\n\x1b[90m');
        isThinking = true;
      }
      process.stdout.write(chunk);
    },
    onToolCallStart: (call): void => {
      resetThinking();
      process.stdout.write(`\n🛠️  Tool: \x1b[36m${call.function.name}\x1b[0m(${JSON.stringify(call.function.arguments)})\n`);
    },
    onToolCallEnd: (res): void => {
      process.stdout.write(`📦 Result: \x1b[32m${res.toolName}\x1b[0m -> ${formatPreview(res.outputString)}...\n`);
    },
    onToken: (token: string): void => {
      resetThinking();
      if (isFirstToken) {
        process.stdout.write('\n💬 Agent Response:\n');
        isFirstToken = false;
      }
      process.stdout.write(token);
    },
  };
};

const executeWithStreaming = async (prompt: string): Promise<void> => {
  await runTradingAgent(prompt, { hooks: createCliHooks() });
  process.stdout.write('\n');
};

const startInteractiveRepl = async (): Promise<void> => {
  const rl = readline.createInterface({ input, output });
  output.write('\n🤖 Crypto Agent Interactive Terminal (type "exit" to quit)\n');

  try {
    while (true) {
      const prompt = (await rl.question('\n💬 You > ')).trim();
      if (!prompt) continue;
      if (prompt.toLowerCase() === 'exit' || prompt.toLowerCase() === 'quit') {
        output.write('👋 Exiting Crypto Agent.\n');
        break;
      }
      await executeWithStreaming(prompt);
    }
  } finally {
    rl.close();
  }
};

const main = async (): Promise<void> => {
  const args = process.argv.slice(2).join(' ').trim();
  if (args) {
    await executeWithStreaming(args);
    return;
  }
  await startInteractiveRepl();
};

main().catch((err: unknown) => {
  process.stderr.write(`Fatal error: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});

