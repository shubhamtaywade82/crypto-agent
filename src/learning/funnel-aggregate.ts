import {
  FUNNEL_GATE_IDS,
  type FunnelGateId,
  type FunnelGateStats,
  type FunnelReport,
  type SetupFunnelObservation,
} from './funnel-types.js';

const SEQUENTIAL: readonly FunnelGateId[] = [
  'macro', 'bias', 'structure', 'liquidity', 'retest', 'trigger', 'confluence', 'rr', 'risk',
];

const passedAt = (o: SetupFunnelObservation, id: FunnelGateId): boolean => {
  if (id === 'observations') return true;
  if (id === 'macro') return o.macro.passed;
  if (id === 'bias') return o.bias.passed;
  if (id === 'structure') return o.structure.passed;
  if (id === 'liquidity') return o.liquidity.passed;
  if (id === 'zone') return false;
  if (id === 'retest') return o.retest.passed;
  if (id === 'trigger') return o.trigger.passed;
  if (id === 'confluence') return o.confluence.passed;
  if (id === 'rr') return o.rr.passed;
  if (id === 'risk') return o.risk.passed;
  return o.final.executable;
};

const priorOk = (o: SetupFunnelObservation, id: FunnelGateId): boolean => {
  if (id === 'observations' || id === 'macro' || id === 'zone' || id === 'executable') return true;
  const idx = SEQUENTIAL.indexOf(id);
  if (idx <= 0) return true;
  return SEQUENTIAL.slice(0, idx).every((g) => passedAt(o, g));
};

const bump = (map: Record<string, number>, key: string): void => {
  map[key] = (map[key] ?? 0) + 1;
};

export const sequentialDeadGate = (gates: readonly FunnelGateStats[]): FunnelGateId | undefined => {
  for (const g of gates) {
    if (g.id === 'observations' || g.id === 'zone' || g.id === 'executable') continue;
    if (g.seen >= 20 && g.passRate < 0.15) return g.id;
  }
  return undefined;
};

export const aggregateFunnel = (
  rows: readonly SetupFunnelObservation[],
  symbol = rows[0]?.symbol ?? ''
): FunnelReport => {
  const reasons: Record<string, number> = {};
  const gates: FunnelGateStats[] = FUNNEL_GATE_IDS.map((id) => {
    let seen = 0;
    let passed = 0;
    for (const row of rows) {
      if (!priorOk(row, id)) continue;
      seen += 1;
      if (passedAt(row, id)) passed += 1;
    }
    const note = id === 'zone' ? 'FVG/OB not in production engine; excluded from sequential dead-gate' : undefined;
    return { id, seen, passed, passRate: seen > 0 ? passed / seen : 0, note };
  });
  for (const row of rows) {
    if (row.final.rejectionReason) bump(reasons, row.final.rejectionReason);
  }
  const samples = rows.filter((r) => !r.final.executable).slice(0, 200);
  return {
    symbol,
    observations: rows.length,
    gates,
    rejectionReasons: reasons,
    deadGate: sequentialDeadGate(gates),
    executable: rows.filter((r) => r.final.executable).length,
    samples,
  };
};
