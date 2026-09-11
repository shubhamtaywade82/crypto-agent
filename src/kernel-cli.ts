if (!process.argv.includes('--headless') && !process.argv.includes('--daemon') && !process.env.LOG_LEVEL) {
  process.env.LOG_LEVEL = 'warn';
}

import { bootEventCouncil } from './engines/event-council.js';
import { getKernel } from './kernel.js';
import { startInteractiveRepl } from './main.js';

const SYMBOLS = (process.env.KERNEL_SYMBOLS ?? 'BTCUSDT,SOLUSDT')
  .split(',')
  .map((s) => s.trim().toUpperCase())
  .filter(Boolean);

const INTERVAL_MS = Number(process.env.KERNEL_SCAN_INTERVAL_MS ?? 300_000);

const runOnce = async (): Promise<void> => {
  const kernel = getKernel();
  await Promise.all(
    SYMBOLS.map((symbol) =>
      kernel.lanes
        .enqueue(symbol, () => kernel.runPipeline(symbol))
        .then((trace) => {
          kernel.log.info('pipeline trace', {
            symbol,
            status: trace.status,
            regime: trace.regime,
            setups: trace.setups.length,
            decisionId: trace.risk?.decisionId,
            approved: trace.risk?.approved,
            order: trace.order,
            error: trace.error,
          });
        })
        .catch((err: unknown) => {
          kernel.log.error('pipeline failed', {
            symbol,
            err: err instanceof Error ? err.message : String(err),
          });
        })
    )
  );
};

const runHeadless = async (): Promise<void> => {
  const kernel = getKernel();
  if (kernel.killSwitch.halted && kernel.venue === 'paper') {
    kernel.killSwitch.resume('paper daemon auto-armed', 'boot');
  }
  kernel.reconciler.start();
  await kernel.startStreams();
  bootEventCouncil(kernel);
  kernel.log.info('kernel loop starting', { symbols: SYMBOLS, intervalMs: INTERVAL_MS, venue: kernel.venue });
  await runOnce();
  const timer = setInterval(() => { void runOnce(); }, INTERVAL_MS);

  const shutdown = (): void => {
    kernel.log.info('kernel loop stopping');
    clearInterval(timer);
    kernel.reconciler.stop();
    kernel.stopStreams();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
};

const main = async (): Promise<void> => {
  const headless = process.argv.includes('--headless') || process.argv.includes('--daemon') || !process.stdout.isTTY;
  if (headless) {
    await runHeadless();
    return;
  }
  await startInteractiveRepl();
};

main().catch((err: unknown) => {
  process.stderr.write(`kernel fatal: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});

