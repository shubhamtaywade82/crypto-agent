import type { Context } from 'hono';
import { getKernel } from '../kernel.js';
import { loadRiskLimits } from '../domain/risk/risk-config.js';
import { auditCaller } from '../security/auth.js';
import type { AuthVariables } from '../security/auth.js';
import { runSetupFunnelFromProvider } from './funnel-replay.js';

/** ADMIN diagnostic replay — does not mutate strategy parameters or the registry. */
export const handleFunnelPost = async (c: Context<AuthVariables>): Promise<Response> => {
  const kernel = getKernel();
  const symbol = c.req.param('symbol')?.toUpperCase() ?? 'BTCUSDT';
  auditCaller(kernel.store, c.get('caller'), 'funnel.run', { symbol });
  const report = await runSetupFunnelFromProvider(kernel.provider, symbol, loadRiskLimits());
  kernel.store.append({
    type: 'funnel.completed',
    symbol,
    payload: {
      observations: report.observations,
      executable: report.executable,
      deadGate: report.deadGate,
      gates: report.gates,
      rejectionReasons: report.rejectionReasons,
    },
  });
  return c.json({
    symbol: report.symbol,
    observations: report.observations,
    executable: report.executable,
    deadGate: report.deadGate ?? null,
    gates: report.gates,
    rejectionReasons: report.rejectionReasons,
    samples: report.samples.slice(0, 25),
  });
};
