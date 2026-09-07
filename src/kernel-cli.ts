import { getKernel } from './kernel.js';

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

const main = async (): Promise<void> => {
  const kernel = getKernel();
  kernel.reconciler.start();
  kernel.log.info('kernel loop starting', { symbols: SYMBOLS, intervalMs: INTERVAL_MS, venue: kernel.venue });
  await runOnce();
  const timer = setInterval(() => {
    void runOnce();
  }, INTERVAL_MS);

  const shutdown = (): void => {
    kernel.log.info('kernel loop stopping');
    clearInterval(timer);
    kernel.reconciler.stop();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
};

main().catch((err: unknown) => {
  process.stderr.write(`kernel fatal: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
