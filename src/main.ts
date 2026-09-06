import 'dotenv/config';
import { runTradingAgent } from './agent.js';

const main = async (): Promise<void> => {
  const prompt =
    process.argv.slice(2).join(' ') ||
    'Check current BTCUSDT price and my spot account balance.';

  // Directly pipe trading agent response to stdout
  const answer = await runTradingAgent(prompt);
  process.stdout.write(`\n--- Agent Response ---\n${answer}\n`);
};

main().catch((err: unknown) => {
  process.stderr.write(`Fatal error: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
