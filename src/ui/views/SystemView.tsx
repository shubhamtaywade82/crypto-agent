import React, { useEffect, useState } from 'react';
import { Box, Text } from 'ink';
import { getKernel } from '../../kernel.js';
import { binanceRateLimiter } from '../../guardians/rate-limiter.js';
import { defaultModel } from '../../config.js';
import { kernelWatchSymbols } from '../../kernel-streams.js';
import { deriveCircuitState } from '../../domain/risk/risk-config.js';

const rule = (): string => '─'.repeat(Math.max(20, (process.stdout.columns || 80) - 6));

const RuntimePanel = (p: { readonly councilOn: boolean; readonly healthy: boolean }): React.JSX.Element => (
  <Box flexDirection="column" flexGrow={1}>
    <Text bold color="yellow">RUNTIME</Text>
    <Text color="gray">├─ Model:         <Text color="white">{defaultModel}</Text></Text>
    <Text color="gray">├─ EventCouncil:  <Text color={p.councilOn ? 'green' : 'yellow'}>{p.councilOn ? 'ENABLED' : 'DISABLED'}</Text></Text>
    <Text color="gray">└─ Event Store:   <Text color={p.healthy ? 'green' : 'red'}>{p.healthy ? 'HEALTHY' : 'UNHEALTHY'}</Text></Text>
  </Box>
);

const MarketPanel = (p: { readonly fresh: number; readonly total: number; readonly weight: number }): React.JSX.Element => (
  <Box flexDirection="column" flexGrow={1}>
    <Text bold color="yellow">MARKET DATA</Text>
    <Text color="gray">├─ Streams:       <Text color={p.fresh === p.total ? 'green' : 'yellow'}>{p.fresh}/{p.total} fresh</Text></Text>
    <Text color="gray">└─ IP Weight:     <Text color={p.weight > 800 ? 'red' : 'white'}>{p.weight} / 1200</Text></Text>
  </Box>
);

const useMarketPoll = (): { fresh: number; total: number } => {
  const [, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 2000);
    return (): void => clearInterval(t);
  }, []);
  const k = getKernel();
  const symbols = kernelWatchSymbols();
  return { fresh: symbols.filter((s) => k.marketStore.isFresh(s, 45_000)).length, total: symbols.length };
};

export const SystemView = (): React.JSX.Element => {
  const k = getKernel();
  const snap = k.portfolio.peek();
  const md = useMarketPoll();
  const circuit = deriveCircuitState(snap.dailyLossPercent, snap.drawdownPercent, snap.lossStreak, k.limits);

  return (
    <Box flexDirection="column" gap={1} paddingX={1}>
      <Text bold color="cyan">SYSTEM HEALTH &amp; INFRASTRUCTURE CONSOLE</Text>
      <Box flexDirection="row" gap={3}>
        <RuntimePanel councilOn={process.env.EVENT_COUNCIL_ENABLED !== 'false'} healthy={k.store.healthy} />
        <MarketPanel fresh={md.fresh} total={md.total} weight={binanceRateLimiter.getCurrentWeight()} />
      </Box>
      <Text color="gray">{rule()}</Text>
      <Box flexDirection="row" gap={3}>
        <Box flexDirection="column" flexGrow={1}>
          <Text bold color="yellow">EXECUTION</Text>
          <Text color="gray">├─ Venue:         <Text color="cyan">{k.venue.toUpperCase()}</Text></Text>
          <Text color="gray">├─ Open orders:   <Text color="white">{k.execution.listOpen().length}</Text></Text>
          <Text color="gray">└─ Open trades:   <Text color="white">{k.ledger.openTrades.length}</Text></Text>
        </Box>
        <Box flexDirection="column" flexGrow={1}>
          <Text bold color="yellow">SAFETY GOVERNOR</Text>
          <Text color="gray">├─ Kill Switch:   <Text color={k.killSwitch.halted ? 'red' : 'green'}>{k.killSwitch.halted ? 'HALTED' : 'ARMED'}</Text></Text>
          <Text color="gray">├─ Circuit:       <Text color="white">{circuit}</Text></Text>
          <Text color="gray">└─ Drawdown:      <Text color="white">{snap.drawdownPercent.toFixed(2)}% / {k.limits.maxDrawdownPercent}%</Text></Text>
        </Box>
      </Box>
    </Box>
  );
};
