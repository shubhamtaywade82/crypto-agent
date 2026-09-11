import 'dotenv/config';

if (process.stdout.isTTY && !process.env.LOG_LEVEL) {
  process.env.LOG_LEVEL = 'warn';
}

import * as readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import React from 'react';
import { render } from 'ink';
import { runTradingAgent } from './agent.js';
import { getKernel } from './kernel.js';
import { App, formatToolArgs, formatToolResult, renderMarkdown } from './ui/App.js';

import type { AgentHooks } from '@nemesis-oss/ollama-sdk';

interface CliHookState {
  hasStreamedToken: boolean;
}

const printToolStart = (name: string, args: unknown): void => {
  process.stdout.write(`\n🛠️  Tool: \x1b[36m${name}\x1b[0m(${formatToolArgs(args)})\n`);
};

const printToolEnd = (name: string, outputString: string): void => {
  process.stdout.write(`📦 Result: \x1b[32m${name}\x1b[0m -> ${formatToolResult(outputString)}\n`);
};

const createCliHooks = (state: CliHookState): AgentHooks => {
  let isThinking = false;

  const resetThinking = (): void => {
    if (isThinking) {
      process.stdout.write('\x1b[0m\n');
      isThinking = false;
    }
  };

  const handleThinking = (chunk: string): void => {
    if (!isThinking) {
      process.stdout.write('\n🧠 Thought:\n\x1b[90m');
      isThinking = true;
    }
    process.stdout.write(chunk);
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
    onThinking: handleThinking,
    onToolCallStart: (call): void => {
      resetThinking();
      printToolStart(call.function.name, call.function.arguments);
    },
    onToolCallEnd: (res): void => printToolEnd(res.toolName, res.outputString),
    onTurnEnd: resetThinking,
    onToken: handleToken,
  };
};

const executeWithStreaming = async (prompt: string): Promise<void> => {
  const state: CliHookState = { hasStreamedToken: false };
  const answer = await runTradingAgent(prompt, { hooks: createCliHooks(state) });
  if (!state.hasStreamedToken && answer) {
    process.stdout.write(`\n💬 Agent Response:\n${renderMarkdown(answer)}\n`);
  }
  process.stdout.write('\n');
};

export const startInteractiveRepl = async (): Promise<void> => {
  if (process.stdin.isTTY) {
    if (!process.env.LOG_LEVEL) process.env.LOG_LEVEL = 'warn';
    const kernel = getKernel();
    if (kernel.killSwitch.halted && kernel.venue === 'paper') {
      kernel.killSwitch.resume('paper mode auto-armed', 'boot');
    }
    const { waitUntilExit } = render(React.createElement(App), {
      exitOnCtrlC: true,
      patchConsole: false,
      alternateScreen: true,
    });
    await waitUntilExit();
    process.stdout.write('\n');
    return;
  }
  const rl = readline.createInterface({ input, output });
  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed || trimmed === 'exit' || trimmed === 'quit') break;
    await executeWithStreaming(trimmed);
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

