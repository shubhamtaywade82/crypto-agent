import React, { useEffect, useState } from 'react';
import { Box, Text } from 'ink';
import { Divider } from '../../components/ui/divider/index.js';
import { ProgressBar } from '../../components/ui/progress-bar/index.js';
import { Badge } from '../../components/ui/badge/index.js';
import { getKernel } from '../../kernel.js';
import { binanceRateLimiter } from '../../guardians/rate-limiter.js';
import { defaultModel } from '../../config.js';
import { kernelWatchSymbols } from '../../kernel-streams.js';
import { deriveCircuitState } from '../../domain/risk/risk-config.js';

const RuntimePanel = (p: { readonly councilOn: boolean; readonly healthy: boolean }): React.JSX.Element => (
  <Box flexDirection="column" flexGrow={1}>
    <Text bold color="yellow">RUNTIME</Text>
    <Text color="gray">├─ Model:         <Text color="white">{defaultModel}</Text></Text>
    <Box gap={1}>
      <Text color="gray">├─ EventCouncil: </Text>
      <Badge variant={p.councilOn ? 'success' : 'warning'}>{p.councilOn ? 'ENABLED' : 'DISABLED'}</Badge>
    </Box>
    <Box gap={1}>
      <Text color="gray">└─ Event Store:  </Text>
      <Badge variant={p.healthy ? 'success' : 'error'}>{p.healthy ? 'HEALTHY' : 'UNHEALTHY'}</Badge>
    </Box>
  </Box>
);

const MarketPanel = (p: { readonly fresh: number; readonly total: number; readonly weight: number }): React.JSX.Element => (
  <Box flexDirection="column" flexGrow={1}>
    <Text bold color="yellow">MARKET DATA</Text>
    <Text color="gray">├─ Streams:       <Text color={p.fresh === p.total ? 'green' : 'yellow'}>{p.fresh}/{p.total} fresh</Text></Text>
    <Box gap={1} alignItems="center">
      <Text color="gray">└─ IP Weight:    </Text>
      <ProgressBar value={(p.weight / 1200) * 100} width={12} showPercent />
      <Text color={p.weight > 800 ? 'red' : 'gray'}>({p.weight}/1200)</Text>
    </Box>
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

interface ExecutionSafetyProps {
  readonly venue: string;
  readonly openOrders: number;
  readonly openTrades: number;
  readonly halted: boolean;
  readonly circuit: string;
  readonly drawdown: number;
  readonly maxDrawdown: number;
}

const ExecutionAndSafetyRow = (p: ExecutionSafetyProps): React.JSX.Element => (
  <Box flexDirection="row" gap={3}>
    <Box flexDirection="column" flexGrow={1}>
      <Text bold color="yellow">EXECUTION</Text>
      <Text color="gray">├─ Venue:         <Text color="cyan">{p.venue.toUpperCase()}</Text></Text>
      <Text color="gray">├─ Open orders:   <Text color="white">{p.openOrders}</Text></Text>
      <Text color="gray">└─ Open trades:   <Text color="white">{p.openTrades}</Text></Text>
    </Box>
    <Box flexDirection="column" flexGrow={1}>
      <Text bold color="yellow">SAFETY GOVERNOR</Text>
      <Box gap={1}>
        <Text color="gray">├─ Kill Switch:  </Text>
        <Badge variant={p.halted ? 'error' : 'success'}>{p.halted ? 'HALTED' : 'ARMED'}</Badge>
      </Box>
      <Box gap={1}>
        <Text color="gray">├─ Circuit:      </Text>
        <Badge variant={p.circuit === 'NORMAL' ? 'success' : 'warning'}>{p.circuit}</Badge>
      </Box>
      <Text color="gray">└─ Drawdown:      <Text color="white">{p.drawdown.toFixed(2)}% / {p.maxDrawdown}%</Text></Text>
    </Box>
  </Box>
);

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
      <Divider style="single" />
      <ExecutionAndSafetyRow
        venue={k.venue} openOrders={k.execution.listOpen().length} openTrades={k.ledger.openTrades.length}
        halted={k.killSwitch.halted} circuit={circuit}
        drawdown={snap.drawdownPercent} maxDrawdown={k.limits.maxDrawdownPercent}
      />
    </Box>
  );
};

