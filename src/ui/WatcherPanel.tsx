import React, { useEffect, useState } from 'react';
import { Box, Text } from 'ink';
import type { WatchOrchestrator } from '../engine/orchestrator.js';
import type { MarketTicker, WatcherStatus, WatchTriggerEvent } from '../types.js';
import { getKernel } from '../kernel.js';
import type { BrokerPosition } from '../infrastructure/broker/broker.js';

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
  readonly positions: readonly BrokerPosition[];
}

const useWatcherData = (orchestrator: WatchOrchestrator): WatcherData => {
  const [statuses, setStatuses] = useState<WatcherStatus[]>([]);
  const [triggers, setTriggers] = useState<TriggerLog[]>([]);
  const [tickers, setTickers] = useState<MarketTicker[]>([]);
  const [positions, setPositions] = useState<readonly BrokerPosition[]>([]);

  useEffect(() => {
    let mounted = true;
    const refresh = async (): Promise<void> => {
      if (!mounted) return;
      setStatuses(orchestrator.getStatuses());
      setTickers(orchestrator.getMarketTickers());
      try {
        const kernel = getKernel();
        const pos = await kernel.broker.getPositions();
        if (mounted) setPositions(pos);
      } catch { /* broker read failure ignored in UI */ }
    };

    void refresh();
    // Throttled 1-second interval eliminates CPU/heap spikes from high-frequency ticks
    const poll = setInterval(() => { void refresh(); }, 1000);
    const unsubTrigger = orchestrator.onTrigger((event: WatchTriggerEvent) => {
      if (!mounted) return;
      setTriggers((prev) => [
        { symbol: event.condition.symbol, price: event.currentPrice, time: formatTriggerTime(event.triggeredAt) },
        ...prev,
      ].slice(0, 5));
    });

    return (): void => {
      mounted = false;
      clearInterval(poll);
      unsubTrigger();
    };
  }, [orchestrator]);

  return { statuses, triggers, tickers, positions };
};

const MarketTickerBar = ({ tickers }: { tickers: MarketTicker[] }): React.JSX.Element => (
  <Box gap={1}>
    <Text color="gray" wrap="truncate">
      <Text bold color="yellow">⚡ Live:</Text>{' '}
      {tickers.map((t, i) => (
        <React.Fragment key={t.symbol}>
          {i > 0 ? ' │ ' : ''}
          <Text color="cyan">{t.symbol.replace('USDT', '')}</Text>{' '}
          <Text color="white">{formatMarketPrice(t.symbol, t.price)}</Text>
        </React.Fragment>
      ))}
    </Text>
  </Box>
);

const PositionsBar = ({ positions }: { positions: readonly BrokerPosition[] }): React.JSX.Element => {
  if (positions.length === 0) {
    return (
      <Text color="gray" wrap="truncate">
        📊 <Text bold color="cyan">Positions (0/2):</Text> No active positions (risk cap: 0.25%/trade · min 2.5 RR)
      </Text>
    );
  }
  return (
    <Box flexDirection="column">
      {positions.map((p, idx) => {
        const upnl = p.unrealizedPnl ?? 0;
        const isProfit = upnl >= 0;
        const notional = Math.abs(p.size * p.entryPrice);
        const pnlPct = notional > 0 ? (upnl / notional) * 100 : 0;
        const key = p.positionId || `${p.pair}-${idx}`;
        return (
          <Text key={key} color="gray" wrap="truncate">
            {p.side === 'long' ? '🟢' : '🔴'} <Text bold color="white">{p.pair}</Text>{' '}
            <Text color={p.side === 'long' ? 'green' : 'red'}>{p.side.toUpperCase()} {p.size}</Text>{' '}
            @ <Text color="white">${p.entryPrice.toFixed(2)}</Text>{' '}
            │ PnL: <Text bold color={isProfit ? 'green' : 'red'}>
              {isProfit ? '+' : ''}${upnl.toFixed(2)} ({isProfit ? '+' : ''}{pnlPct.toFixed(2)}%)
            </Text>
          </Text>
        );
      })}
    </Box>
  );
};

const WatchList = ({ statuses }: { statuses: WatcherStatus[] }): React.JSX.Element => (
  <Box gap={1}>
    <Text color="gray" wrap="truncate">
      📡 <Text bold color="yellow">Watches ({statuses.length}):</Text>{' '}
      {statuses.slice(0, 3).map((w, idx) => (
        <React.Fragment key={w.id}>
          {idx > 0 ? ' │ ' : ''}
          {directionIcon(w.type)} <Text color="cyan">{w.symbol.replace('USDT', '')}</Text>{' '}
          <Text color="yellow">{w.type === 'price_above' ? '>' : '<'}${w.targetPrice}</Text>
          {w.currentPrice !== undefined ? (
            <Text color="gray"> ({formatDistance(w.currentPrice, w.targetPrice)})</Text>
          ) : null}
        </React.Fragment>
      ))}
      {statuses.length > 3 ? ` (+${statuses.length - 3} more)` : ''}
    </Text>
  </Box>
);

const TriggerList = ({ triggers }: { triggers: TriggerLog[] }): React.JSX.Element => (
  <Text color="yellow" wrap="truncate">
    🔔 <Text bold color="red">Triggers:</Text>{' '}
    {triggers.slice(0, 3).map((t, i) => (
      <React.Fragment key={`trig-${i}`}>
        {i > 0 ? ' │ ' : ''}
        ⚡ {t.symbol.replace('USDT', '')} @ ${t.price} [{t.time}]
      </React.Fragment>
    ))}
  </Text>
);

export const WatcherPanel = ({ orchestrator }: { orchestrator: WatchOrchestrator }): React.JSX.Element => {
  const { statuses, triggers, tickers, positions } = useWatcherData(orchestrator);
  return (
    <Box flexDirection="column">
      <MarketTickerBar tickers={tickers} />
      <PositionsBar positions={positions} />
      {statuses.length > 0 && <WatchList statuses={statuses} />}
      {triggers.length > 0 && <TriggerList triggers={triggers} />}
    </Box>
  );
};
