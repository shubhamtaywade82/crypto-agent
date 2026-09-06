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
  <Box flexDirection="column">
    <Text bold color="yellow">📡 Active Watchers:</Text>
    {statuses.map((w) => (
      <Text key={w.id} color="gray">
        {'  '}{directionIcon(w.type)} {w.symbol}: {w.type === 'price_above' ? '>' : '<'} ${w.targetPrice} — {w.strategy}
        {' '}({w.isConnected ? '🟢 live' : '🔴 disconnected'})
      </Text>
    ))}
  </Box>
);

const TriggerList = ({ triggers }: { triggers: TriggerLog[] }): React.JSX.Element => (
  <Box flexDirection="column" marginTop={1}>
    <Text bold color="red">🔔 Recent Triggers:</Text>
    {triggers.map((t, i) => (
      <Text key={`trig-${i}`} color="yellow">
        {'  '}⚡ {t.symbol} @ ${t.price} [{t.time}]
      </Text>
    ))}
  </Box>
);

export const WatcherPanel = ({ orchestrator }: { orchestrator: WatchOrchestrator }): React.JSX.Element => {
  const { statuses, triggers } = useWatcherData(orchestrator);
  if (statuses.length === 0 && triggers.length === 0) return <Box />;
  return (
    <Box flexDirection="column" marginBottom={1}>
      {statuses.length > 0 && <WatchList statuses={statuses} />}
      {triggers.length > 0 && <TriggerList triggers={triggers} />}
    </Box>
  );
};
