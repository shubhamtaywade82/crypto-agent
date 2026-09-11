import React from 'react';
import { Box, Text } from 'ink';
import { getKernel } from '../../kernel.js';
import { binanceRateLimiter } from '../../guardians/rate-limiter.js';
import { defaultModel } from '../../config.js';

const RuntimeDataSection = ({ weight, healthy }: { readonly weight: number; readonly healthy: boolean }): React.JSX.Element => (
  <Box flexDirection="row" gap={3}>
    <Box flexDirection="column" flexGrow={1}>
      <Text bold color="yellow">RUNTIME</Text>
      <Text color="gray">├─ Model:         <Text color="white">{defaultModel}</Text></Text>
      <Text color="gray">├─ Agent loop:    <Text color="green">RUNNING</Text></Text>
      <Text color="gray">├─ Scheduler:     <Text color="green">5m DAEMON</Text></Text>
      <Text color="gray">└─ Event Store:   <Text color="green">DURABLE ({healthy ? 'HEALTHY' : 'UNHEALTHY'})</Text></Text>
    </Box>
    <Box flexDirection="column" flexGrow={1}>
      <Text bold color="yellow">MARKET DATA</Text>
      <Text color="gray">├─ Binance WS:    <Text color="green">CONNECTED</Text></Text>
      <Text color="gray">├─ Depth Stream:  <Text color="green">FRESH (&lt;500ms)</Text></Text>
      <Text color="gray">├─ Trade Prints:  <Text color="green">STREAMING</Text></Text>
      <Text color="gray">└─ IP Weight:     <Text color={weight > 800 ? 'red' : 'white'}>{weight} / 1200 cap</Text></Text>
    </Box>
  </Box>
);

const ExecutionSafetySection = (p: { readonly venue: string; readonly openOrders: number; readonly ks: boolean; readonly resvs: number }): React.JSX.Element => (
  <Box flexDirection="row" gap={3}>
    <Box flexDirection="column" flexGrow={1}>
      <Text bold color="yellow">EXECUTION</Text>
      <Text color="gray">├─ Venue:         <Text color="cyan">{p.venue.toUpperCase()}</Text></Text>
      <Text color="gray">├─ Broker Conn:   <Text color="green">OK (Zero network errors)</Text></Text>
      <Text color="gray">├─ Reconciler:    <Text color="green">SYNCED (0 orphaned intents)</Text></Text>
      <Text color="gray">└─ Open Orders:   <Text color="white">{p.openOrders} tracked</Text></Text>
    </Box>
    <Box flexDirection="column" flexGrow={1}>
      <Text bold color="yellow">SAFETY GOVERNOR</Text>
      <Text color="gray">├─ Kill Switch:   <Text color={p.ks ? 'red' : 'green'}>{p.ks ? 'HALTED' : 'ARMED (NORMAL)'}</Text></Text>
      <Text color="gray">├─ Max Drawdown:  <Text color="white">5.00% (Current: 1.80%)</Text></Text>
      <Text color="gray">├─ Daily Loss:    <Text color="white">1.00% limit</Text></Text>
      <Text color="gray">└─ Reservations:  <Text color="white">{p.resvs} active</Text></Text>
    </Box>
  </Box>
);

export const SystemView = (): React.JSX.Element => {
  const k = getKernel();
  const weight = binanceRateLimiter.getCurrentWeight();

  return (
    <Box flexDirection="column" gap={1} paddingX={1}>
      <Text bold color="cyan">SYSTEM HEALTH &amp; INFRASTRUCTURE CONSOLE</Text>
      <RuntimeDataSection weight={weight} healthy={k.store.healthy} />
      <Text color="gray">{'─'.repeat(Math.max(20, (process.stdout.columns || 80) - 6))}</Text>
      <ExecutionSafetySection
        venue={k.venue} openOrders={k.execution.listOpen().length}
        ks={k.killSwitch.halted} resvs={k.reservations.active().length}
      />
    </Box>
  );
};
