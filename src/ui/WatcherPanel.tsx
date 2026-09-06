import React, { useEffect, useState } from 'react';
import { Box, Text } from 'ink';
import type { WatchOrchestrator } from '../engine/orchestrator.js';
import type { MarketTicker, WatcherStatus, WatchTriggerEvent } from '../types.js';

interface TriggerLog { readonly symbol: string; readonly price: number; readonly time: string; }

const formatTriggerTime = (ts: number): string =>
  new Date(ts).toLocaleTimeString('en-IN', { hour12: false, timeZone: 'Asia/Kolkata' });

const directionIcon = (type: string): string => (type === 'price_above' ? '📈' : '📉');

const formatDistance = (current: number, target: number): string => {
  const pct = ((target - current) / current) * 100;
  return `${pct > 0 ? '+' : ''}${pct.toFixed(2)}%`;
};

const formatMarketPrice = (sym: string, p: number | undefined): string => {
  if (p === undefined) return '...';
  if (sym === 'XRPUSDT') return `$${p.toFixed(4)}`;
  return `$${p.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

interface WatcherData {
  readonly statuses: WatcherStatus[];
  readonly triggers: TriggerLog[];
  readonly tickers: MarketTicker[];
}

const useWatcherData = (orchestrator: WatchOrchestrator): WatcherData => {
  const [statuses, setStatuses] = useState<WatcherStatus[]>([]);
  const [triggers, setTriggers] = useState<TriggerLog[]>([]);
  const [tickers, setTickers] = useState<MarketTicker[]>([]);

  useEffect(() => {
    const refresh = (): void => {
      setStatuses(orchestrator.getStatuses());
      setTickers(orchestrator.getMarketTickers());
    };
    refresh();
    orchestrator.onTick(refresh);
    const poll = setInterval(refresh, 1000);
    const onTrigger = (event: WatchTriggerEvent): void => {
      setTriggers((prev) => [
        { symbol: event.condition.symbol, price: event.currentPrice, time: formatTriggerTime(event.triggeredAt) },
        ...prev,
      ].slice(0, 5));
    };
    orchestrator.onTrigger(onTrigger);
    return (): void => clearInterval(poll);
  }, [orchestrator]);

  return { statuses, triggers, tickers };
};

const MarketTickerBar = ({ tickers }: { tickers: MarketTicker[] }): React.JSX.Element => (
  <Box flexWrap="wrap" gap={1}>
    <Text bold color="yellow">⚡ Live:</Text>
    {tickers.map((t, i) => (
      <Text key={t.symbol} color="gray">
        {i > 0 && <Text color="gray">│ </Text>}
        <Text color="cyan">{t.symbol.replace('USDT', '')}</Text>{' '}
        <Text color="white">{formatMarketPrice(t.symbol, t.price)}</Text>
      </Text>
    ))}
  </Box>
);

const WatchItem = ({ w }: { w: WatcherStatus }): React.JSX.Element => {
  const isClose = w.currentPrice !== undefined
    ? Math.abs((w.targetPrice - w.currentPrice) / w.currentPrice) < 0.005
    : false;

  return (
    <Text color="gray">
      {directionIcon(w.type)} <Text color="cyan">{w.symbol}</Text>{' '}
      {w.currentPrice !== undefined ? (
        <Text>
          <Text color="white">${w.currentPrice.toFixed(2)}</Text>{' '}
          <Text color="gray">➔</Text>{' '}
          <Text color="yellow">{w.type === 'price_above' ? '>' : '<'}${w.targetPrice}</Text>{' '}
          <Text color={isClose ? 'red' : 'gray'}>({formatDistance(w.currentPrice, w.targetPrice)})</Text>
        </Text>
      ) : (
        <Text color="yellow">{w.type === 'price_above' ? '>' : '<'}${w.targetPrice}</Text>
      )}
    </Text>
  );
};

const WatchList = ({ statuses }: { statuses: WatcherStatus[] }): React.JSX.Element => (
  <Box flexWrap="wrap" gap={1}>
    <Text color="gray">📡 <Text bold color="yellow">Watches ({statuses.length}):</Text></Text>
    {statuses.map((w, idx) => (
      <Box key={w.id}>
        {idx > 0 && <Text color="gray">│ </Text>}
        <WatchItem w={w} />
      </Box>
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
  const { statuses, triggers, tickers } = useWatcherData(orchestrator);
  return (
    <Box flexDirection="column" marginY={1}>
      <MarketTickerBar tickers={tickers} />
      {statuses.length > 0 && <WatchList statuses={statuses} />}
      {triggers.length > 0 && <TriggerList triggers={triggers} />}
    </Box>
  );
};
