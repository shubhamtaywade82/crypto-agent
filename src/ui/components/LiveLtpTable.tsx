import React, { useEffect, useMemo, useState } from 'react';
import { Box, Text } from 'ink';
import { getKernel } from '../../kernel.js';
import { fmtPrice } from '../KernelDashboard.js';
import { kernelWatchSymbols } from '../../kernel-streams.js';

const STALE_MS = 5_000;

export const useLiveTick = (intervalMs = 300): number => {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), intervalMs);
    return (): void => clearInterval(t);
  }, [intervalMs]);
  return tick;
};

export const liveQuote = (symbol: string): {
  readonly ltp?: number; readonly bid?: number; readonly ask?: number;
  readonly mark?: number; readonly live: boolean;
} => {
  const kernel = getKernel();
  const snap = kernel.marketStore.snapshot(symbol);
  if (!snap) return { live: false };
  const stale = (kernel.marketStore.stalenessMs(symbol) ?? Infinity) > STALE_MS;
  const bid = snap.bestBid ?? snap.bids[0]?.price;
  const ask = snap.bestAsk ?? snap.asks[0]?.price;
  const ltp = snap.last ?? snap.mark ?? (bid !== undefined && ask !== undefined ? (bid + ask) / 2 : undefined);
  return { ltp, bid, ask, mark: snap.mark, live: !stale && ltp !== undefined };
};

const pad = (v: string, n: number): string => v.padEnd(n);

export const LiveLtpTable = (): React.JSX.Element => {
  useLiveTick();
  const symbols = useMemo(() => kernelWatchSymbols(), []);
  const traded = useMemo(() => new Set(
    (process.env.KERNEL_SYMBOLS ?? 'SOLUSDT,ETHUSDT,XRPUSDT').split(',').map((s) => s.trim().toUpperCase())
  ), []);

  return (
    <Box flexDirection="column">
      <Box justifyContent="space-between">
        <Text bold color="cyan">LIVE LTP — ALL SYMBOLS</Text>
        <Text color="gray">WS miniTicker + bookTicker</Text>
      </Box>
      <Text color="gray">
        {pad('SYMBOL', 10)}{pad('LTP', 14)}{pad('BID', 14)}{pad('ASK', 14)}{pad('MARK', 14)}STATUS
      </Text>
      {symbols.map((sym) => {
        const q = liveQuote(sym);
        const isAnchor = sym === 'BTCUSDT' && !traded.has('BTCUSDT');
        const status = isAnchor ? '● ANCHOR' : q.live ? '● LIVE' : q.ltp !== undefined ? '○ STALE' : '… WAIT';
        const statusColor = isAnchor ? 'cyan' : q.live ? 'green' : q.ltp !== undefined ? 'yellow' : 'gray';
        return (
          <Text key={sym} wrap="truncate">
            <Text bold color={isAnchor ? 'yellow' : undefined}>{pad(sym, 10)}</Text>
            <Text color="white">{pad(q.ltp !== undefined ? fmtPrice(q.ltp) : '—', 14)}</Text>
            <Text color="green">{pad(q.bid !== undefined ? fmtPrice(q.bid) : '—', 14)}</Text>
            <Text color="red">{pad(q.ask !== undefined ? fmtPrice(q.ask) : '—', 14)}</Text>
            <Text color="gray">{pad(q.mark !== undefined ? fmtPrice(q.mark) : '—', 14)}</Text>
            <Text color={statusColor}>{status}</Text>
          </Text>
        );
      })}
    </Box>
  );
};
