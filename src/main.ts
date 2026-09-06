import 'dotenv/config';
import * as readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { runTradingAgent } from './agent.js';

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
      output.write('🤖 Agent thinking with ReAct...\n');
      const answer = await runTradingAgent(prompt);
      output.write(`\n--- Agent Response ---\n${answer}\n`);
    }
  } finally {
    rl.close();
  }
};

const main = async (): Promise<void> => {
  const args = process.argv.slice(2).join(' ').trim();
  if (args) {
    const answer = await runTradingAgent(args);
    process.stdout.write(`\n--- Agent Response ---\n${answer}\n`);
    return;
  }
  await startInteractiveRepl();
};

main().catch((err: unknown) => {
  process.stderr.write(`Fatal error: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});

