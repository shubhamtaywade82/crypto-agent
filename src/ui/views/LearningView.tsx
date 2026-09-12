import React, { useEffect, useState } from 'react';
import { Box, Text } from 'ink';
import { Divider } from '../../components/ui/divider/index.js';
import { ProgressBar } from '../../components/ui/progress-bar/index.js';
import { getKernel } from '../../kernel.js';
import type { TradeOutcomeRecord } from '../../learning/trade-ledger.js';

const formatEventFinding = (type: string, payload: Record<string, unknown>): string => {
  if (type === 'strategy.promoted') return `Cell promoted: ${String(payload.cell ?? payload.strategyId ?? '')}`;
  if (type === 'strategy.retired') return `Strategy retired: ${String(payload.reason ?? payload.strategyId ?? '')}`;
  if (type === 'pipeline.rejected') return `Pipeline rejected on ${String(payload.symbol ?? '')}`;
  if (type === 'trade.closed') return `Trade closed · R=${String(payload.rMultiple ?? '?')}`;
  return type;
};

const ledgerStats = (outcomes: readonly TradeOutcomeRecord[]): {
  count: number; winRate: number; netPnl: number; avgR: number; pf: number;
} => {
  const count = outcomes.length;
  const wins = outcomes.filter((o) => o.pnl > 0).length;
  const netPnl = outcomes.reduce((acc, o) => acc + o.pnl, 0);
  const avgR = count > 0 ? outcomes.reduce((a, o) => a + o.rMultiple, 0) / count : 0;
  const grossWin = outcomes.filter((o) => o.pnl > 0).reduce((a, o) => a + o.pnl, 0);
  const grossLoss = Math.abs(outcomes.filter((o) => o.pnl < 0).reduce((a, o) => a + o.pnl, 0));
  const pf = grossLoss > 0 ? grossWin / grossLoss : grossWin > 0 ? 99 : 0;
  return { count, winRate: count > 0 ? (wins / count) * 100 : 0, netPnl, avgR, pf };
};

const useLedgerPoll = (): ReturnType<typeof getKernel>['ledger'] => {
  const [, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 3000);
    return (): void => clearInterval(t);
  }, []);
  return getKernel().ledger;
};

const StatsRow = ({ stats, openTrades }: { readonly stats: ReturnType<typeof ledgerStats>; readonly openTrades: number }): React.JSX.Element => (
  <Box flexDirection="row" gap={3} flexWrap="wrap">
    <Text color="gray">Closed: <Text bold color="white">{stats.count}</Text></Text>
    <Text color="gray">Open: <Text bold color="white">{openTrades}</Text></Text>
    <Text color="gray">Win Rate: <Text bold color="green">{stats.winRate.toFixed(1)}%</Text></Text>
    <Text color="gray">Net PnL: <Text bold color={stats.netPnl >= 0 ? 'green' : 'red'}>{stats.netPnl >= 0 ? '+' : ''}${stats.netPnl.toFixed(2)}</Text></Text>
    <Text color="gray">Avg R: <Text bold color="white">{stats.avgR >= 0 ? '+' : ''}{stats.avgR.toFixed(2)}R</Text></Text>
    <Text color="gray">PF: <Text bold color="white">{stats.pf > 0 ? stats.pf.toFixed(2) : '—'}</Text></Text>
  </Box>
);

interface LearningData {
  readonly findings: readonly { readonly time: string; readonly title: string; readonly note: string }[];
  readonly byRegime: Map<string, { wins: number; n: number }>;
}

const useLearningData = (
  k: ReturnType<typeof getKernel>,
  outcomes: readonly { regime: string; pnl: number }[]
): LearningData => {
  const findings = k.store.tail(40)
    .filter((e) => e.type.startsWith('strategy.') || e.type.startsWith('trade.') || e.type.includes('pipeline'))
    .slice(-6).reverse()
    .map((e) => ({
      time: new Date(e.at).toLocaleTimeString('en-IN', { hour12: false }),
      title: e.type,
      note: formatEventFinding(e.type, e.payload as Record<string, unknown>),
    }));
  const byRegime = new Map<string, { wins: number; n: number }>();
  for (const o of outcomes) {
    const bucket = byRegime.get(o.regime) ?? { wins: 0, n: 0 };
    bucket.n += 1;
    if (o.pnl > 0) bucket.wins += 1;
    byRegime.set(o.regime, bucket);
  }
  return { findings, byRegime };
};

export const LearningView = (): React.JSX.Element => {
  const ledger = useLedgerPoll();
  const k = getKernel();
  const stats = ledgerStats(ledger.outcomes);
  const { findings, byRegime } = useLearningData(k, ledger.outcomes);

  return (
    <Box flexDirection="column" gap={1}>
      <Text bold color="cyan">SELF-IMPROVING TRADE LEDGER &amp; EMPIRICAL LEARNING</Text>
      <StatsRow stats={stats} openTrades={ledger.openTrades.length} />
      <Divider style="single" />
      <Text bold color="yellow">EVENT-DRIVEN FINDINGS (from durable store)</Text>
      {findings.length === 0 ? (
        <Text color="gray" italic>No learning events yet — closed trades and promotions will appear here.</Text>
      ) : findings.map((f) => (
        <Text key={`${f.time}-${f.title}`} color="gray">[{f.time}] <Text bold color="white">{f.title}</Text> ↳ {f.note}</Text>
      ))}
      <Divider style="single" />
      <Text bold color="cyan">WIN-RATE BY REGIME (ledger)</Text>
      {[...byRegime.entries()].length === 0 ? (
        <Text color="gray" italic>No closed trades attributed to regimes yet.</Text>
      ) : [...byRegime.entries()].sort((a, b) => b[1].n - a[1].n).map(([regime, { wins, n }]) => {
        const wr = n > 0 ? (wins / n) * 100 : 0;
        return (
          <Box key={regime} gap={1} alignItems="center">
            <Text color="gray">{regime.padEnd(16)}</Text>
            <ProgressBar value={wr} width={12} showPercent />
            <Text color="gray">(n={n})</Text>
          </Box>
        );
      })}
    </Box>
  );
};
