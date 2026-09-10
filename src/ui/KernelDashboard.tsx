import React, { useEffect, useState } from 'react';
import { Box, Text } from 'ink';
import { getKernel } from '../kernel.js';
import type { BookLevel, TradePrint } from '../domain/market/microstructure.js';
import type { SymbolSnapshot } from '../engines/market-state-store.js';
import { ensureSymbolTracked } from '../engines/market-hydrate.js';

export interface ActivityEntry {
  readonly id: string;
  readonly at: string;
  readonly text: string;
}

const bar = (qty: number, max: number, width = 8): string => {
  const filled = max > 0 ? Math.round((qty / max) * width) : 0;
  return `${'█'.repeat(filled)}${'░'.repeat(Math.max(0, width - filled))}`;
};

const fmtPrice = (p: number): string =>
  p.toLocaleString('en-US', { maximumFractionDigits: 4 });

const quotePrice = (snap: SymbolSnapshot | undefined): number | undefined => {
  if (!snap) return undefined;
  if (snap.last !== undefined) return snap.last;
  if (snap.bestBid !== undefined && snap.bestAsk !== undefined) return (snap.bestBid + snap.bestAsk) / 2;
  if (snap.bids[0] && snap.asks[0]) return (snap.bids[0].price + snap.asks[0].price) / 2;
  return undefined;
};

const DepthLadder = ({ bids, asks }: { bids: readonly BookLevel[]; asks: readonly BookLevel[] }): React.JSX.Element => {
  const topAsks = [...asks].slice(0, 4).reverse();
  const topBids = bids.slice(0, 4);
  const maxQty = Math.max(...[...topAsks, ...topBids].map((l) => l.qty), 0.0001);
  return (
    <Box flexDirection="column">
      {topAsks.map((l) => (
        <Text key={`a-${l.price}`} color="red">ASK {fmtPrice(l.price).padStart(12)} {bar(l.qty, maxQty)} {l.qty.toFixed(2)}</Text>
      ))}
      <Text color="gray">{'─'.repeat(32)}</Text>
      {topBids.map((l) => (
        <Text key={`b-${l.price}`} color="green">BID {fmtPrice(l.price).padStart(12)} {bar(l.qty, maxQty)} {l.qty.toFixed(2)}</Text>
      ))}
    </Box>
  );
};

const Tape = ({ trades }: { trades: readonly TradePrint[] }): React.JSX.Element => (
  <Box flexDirection="column">
    {trades.slice(-6).reverse().map((t, i) => (
      <Text key={`${t.at}-${i}`} color={t.buyerIsMaker ? 'red' : 'green'}>
        {t.buyerIsMaker ? 'S' : 'B'} {t.qty.toFixed(3)} @ {fmtPrice(t.price)}
      </Text>
    ))}
    {trades.length === 0 && <Text color="gray">waiting for trades…</Text>}
  </Box>
);

const SymbolRows = ({ symbols }: { symbols: readonly string[] }): React.JSX.Element => {
  const kernel = getKernel();
  return (
    <Box flexDirection="column">
      {symbols.map((sym) => {
        const snap = kernel.marketStore.snapshot(sym);
        const m = snap?.microstructure;
        const px = quotePrice(snap);
        const stale = snap ? kernel.marketStore.stalenessMs(sym) : undefined;
        return (
          <Text key={sym} wrap="truncate">
            <Text bold>{sym.replace('USDT', '')}</Text> {px !== undefined ? fmtPrice(px) : '…'}
            {m ? <Text color="gray"> spr {m.spreadBps.toFixed(1)}bps imb {(m.imbalance * 100).toFixed(0)}% {m.flowBias}</Text>
              : <Text color="gray"> {snap ? 'awaiting depth' : 'not subscribed'}</Text>}
            {stale !== undefined && stale > 30_000 ? <Text color="red"> STALE</Text> : null}
          </Text>
        );
      })}
    </Box>
  );
};

interface DashboardProps {
  readonly symbols: readonly string[];
  readonly focusSymbol: string;
  readonly activity: readonly ActivityEntry[];
  readonly streamLive: boolean;
}

export const KernelDashboard = ({
  symbols, focusSymbol, activity, streamLive,
}: DashboardProps): React.JSX.Element => {
  const [, setTick] = useState(0);
  useEffect(() => {
    void ensureSymbolTracked(focusSymbol);
  }, [focusSymbol]);
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 500);
    return (): void => clearInterval(t);
  }, []);
  const focus = getKernel().marketStore.snapshot(focusSymbol);
  const micro = focus?.microstructure;

  return (
    <Box flexDirection="column">
      <Text bold color="cyan">📊 Kernel Dashboard</Text>
      <Text color="gray">Stream <Text color={streamLive ? 'green' : 'yellow'}>{streamLive ? 'LIVE' : 'REST'}</Text> │ Focus <Text color="yellow">{focusSymbol}</Text></Text>
      <Box marginY={1}><SymbolRows symbols={symbols} /></Box>
      <Box flexDirection="row">
        <Box width="50%" flexDirection="column" paddingRight={1}>
          <Text bold color="yellow">Depth</Text>
          {focus?.bids.length ? <DepthLadder bids={focus.bids} asks={focus.asks} /> : <Text color="gray">depth unavailable</Text>}
        </Box>
        <Box width="50%" flexDirection="column">
          <Text bold color="yellow">Tape</Text>
          <Tape trades={focus?.trades ?? []} />
        </Box>
      </Box>
      {micro && <Text color="gray">Δ ${micro.tradeDelta.toFixed(0)} │ bid {micro.bidDepth.toFixed(1)} ask {micro.askDepth.toFixed(1)}</Text>}
      <Box marginTop={1} flexDirection="column">
        <Text bold color="cyan">Activity</Text>
        {activity.length === 0 ? <Text color="gray">/scan logs pipeline results here</Text>
          : activity.slice(0, 6).map((a) => <Text key={a.id} color="gray" wrap="truncate">[{a.at}] {a.text}</Text>)}
      </Box>
    </Box>
  );
};
