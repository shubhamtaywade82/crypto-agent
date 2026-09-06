import 'dotenv/config';
import * as readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { runTradingAgent } from './agent.js';

import type { AgentHooks } from '@nemesis-oss/ollama-sdk';

const formatPreview = (val: unknown): string =>
  (typeof val === 'object' ? JSON.stringify(val) : String(val)).slice(0, 80);

interface CliHookState {
  hasStreamedToken: boolean;
}

const printToolStart = (name: string, args: unknown): void => {
  process.stdout.write(`\n🛠️  Tool: \x1b[36m${name}\x1b[0m(${JSON.stringify(args)})\n`);
};

const printToolEnd = (name: string, outputString: string): void => {
  process.stdout.write(`📦 Result: \x1b[32m${name}\x1b[0m -> ${formatPreview(outputString)}...\n`);
};

const printThought = (thought: string): void => {
  process.stdout.write(`\n🧠 Thought:\n\x1b[90m${thought.trim()}\x1b[0m\n`);
};

const createCliHooks = (state: CliHookState): AgentHooks => {
  let isThinking = false;

  const resetThinking = (): void => {
    if (isThinking) {
      process.stdout.write('\x1b[0m\n');
      isThinking = false;
    }
  };

  const handleToken = (token: string): void => {
    resetThinking();
    if (!state.hasStreamedToken) {
      process.stdout.write('\n💬 Agent Response:\n');
      state.hasStreamedToken = true;
    }
    process.stdout.write(token);
  };

  return {
    onToolCallStart: (call): void => {
      resetThinking();
      printToolStart(call.function.name, call.function.arguments);
    },
    onToolCallEnd: (res): void => printToolEnd(res.toolName, res.outputString),
    onTurnEnd: (turn): void => {
      resetThinking();
      if (turn.message.thinking) printThought(turn.message.thinking);
    },
    onToken: handleToken,
  };
};

const executeWithStreaming = async (prompt: string): Promise<void> => {
  const state: CliHookState = { hasStreamedToken: false };
  const answer = await runTradingAgent(prompt, { hooks: createCliHooks(state) });
  if (!state.hasStreamedToken && answer) {
    process.stdout.write(`\n💬 Agent Response:\n${answer}\n`);
  }
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

