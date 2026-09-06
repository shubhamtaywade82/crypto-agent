import React, { useEffect, useState } from 'react';
import { Box, Text } from 'ink';
import type { WatchOrchestrator } from '../engine/orchestrator.js';
import type { WatcherStatus, WatchTriggerEvent } from '../types.js';

interface TriggerLog { readonly symbol: string; readonly price: number; readonly time: string; }

const formatTriggerTime = (ts: number): string =>
  new Date(ts).toLocaleTimeString('en-IN', { hour12: false, timeZone: 'Asia/Kolkata' });

const directionIcon = (type: string): string =>
  type === 'price_above' ? '📈' : '📉';

const useWatcherData = (orchestrator: WatchOrchestrator): { statuses: WatcherStatus[]; triggers: TriggerLog[] } => {
  const [statuses, setStatuses] = useState<WatcherStatus[]>([]);
  const [triggers, setTriggers] = useState<TriggerLog[]>([]);

  useEffect(() => {
    setStatuses(orchestrator.getStatuses());
    const poll = setInterval(() => setStatuses(orchestrator.getStatuses()), 2000);
    const onTrigger = (event: WatchTriggerEvent): void => {
      const log: TriggerLog = {
        symbol: event.condition.symbol,
        price: event.currentPrice,
        time: formatTriggerTime(event.triggeredAt),
      };
      setTriggers((prev) => [log, ...prev].slice(0, 5));
    };
    orchestrator.onTrigger(onTrigger);
    return (): void => clearInterval(poll);
  }, [orchestrator]);

  return { statuses, triggers };
};

const WatchList = ({ statuses }: { statuses: WatcherStatus[] }): React.JSX.Element => (
  <Box flexWrap="wrap" gap={1}>
    <Text color="gray">📡 <Text bold color="yellow">Watches ({statuses.length}):</Text></Text>
    {statuses.map((w, idx) => (
      <Text key={w.id} color="gray">
        {idx > 0 && <Text color="gray">│ </Text>}
        {directionIcon(w.type)} <Text color="cyan">{w.symbol}</Text> {w.type === 'price_above' ? '>' : '<'} <Text color="yellow">${w.targetPrice}</Text>
        {' '}<Text color={w.isConnected ? 'green' : 'red'}>({w.isConnected ? 'live' : 'offline'})</Text>
      </Text>
    ))}
  </Box>
);

const TriggerList = ({ triggers }: { triggers: TriggerLog[] }): React.JSX.Element => (
  <Box flexWrap="wrap" gap={1}>
    <Text color="red">🔔 <Text bold color="red">Triggers:</Text></Text>
    {triggers.slice(0, 3).map((t, i) => (
      <Text key={`trig-${i}`} color="yellow">
        {i > 0 && <Text color="gray">│ </Text>}
        ⚡ {t.symbol} @ ${t.price} [{t.time}]
      </Text>
    ))}
  </Box>
);

export const WatcherPanel = ({ orchestrator }: { orchestrator: WatchOrchestrator }): React.JSX.Element => {
  const { statuses, triggers } = useWatcherData(orchestrator);
  if (statuses.length === 0 && triggers.length === 0) return <Box />;
  return (
    <Box flexDirection="column" marginTop={1}>
      {statuses.length > 0 && <WatchList statuses={statuses} />}
      {triggers.length > 0 && <TriggerList triggers={triggers} />}
    </Box>
  );
};
