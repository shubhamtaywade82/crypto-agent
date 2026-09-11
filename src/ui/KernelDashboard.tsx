import React, { useEffect, useState } from 'react';
import { Box, Text } from 'ink';
import { getKernel } from '../kernel.js';
import type { BookLevel, MicrostructureView, TradePrint } from '../domain/market/microstructure.js';
import type { SymbolSnapshot } from '../engines/market-state-store.js';
import { ensureSymbolTracked } from '../engines/market-hydrate.js';
import { LiveTape } from './components/LiveTape.js';

export interface ActivityEntry {
  readonly id: string;
  readonly at: string;
  readonly text: string;
}

const DEPTH_LEVELS = 5;
const W_QTY = 9;
const W_VOL = 8;
const W_PX = 11;

export const fmtPrice = (p: number): string =>
  p.toLocaleString('en-US', { maximumFractionDigits: 4 });

export const fmtVol = (notional: number): string => {
  if (notional >= 1_000_000) return `$${(notional / 1_000_000).toFixed(2)}M`;
  if (notional >= 10_000) return `$${(notional / 1_000).toFixed(1)}k`;
  return `$${notional.toFixed(0)}`;
};

const levelNotional = (l: BookLevel): number => l.price * l.qty;
const bookNotional = (levels: readonly BookLevel[]): number =>
  levels.reduce((acc, l) => acc + levelNotional(l), 0);

const fmtQtyCol = (q: number): string => q.toFixed(3).padStart(W_QTY);
const fmtVolCol = (v: number): string => fmtVol(v).padStart(W_VOL);
const fmtPxCol = (p: number): string => fmtPrice(p).padStart(W_PX);
const leftPad = W_QTY + 1 + W_VOL + 1 + W_PX;

export const quotePrice = (snap: SymbolSnapshot | undefined): number | undefined => {
  if (!snap) return undefined;
  if (snap.last !== undefined) return snap.last;
  if (snap.mark !== undefined) return snap.mark;
  if (snap.bestBid !== undefined && snap.bestAsk !== undefined) return (snap.bestBid + snap.bestAsk) / 2;
  if (snap.bids[0] && snap.asks[0]) return (snap.bids[0].price + snap.asks[0].price) / 2;
  return undefined;
};

const pxLabel = (label: string, value: number | undefined): string =>
  value !== undefined ? `${label} ${fmtPrice(value)}` : `${label} —`;

const bookTone = (imbPct: number): string => {
  if (imbPct > 12) return 'Bid-heavy book — resting size below';
  if (imbPct < -12) return 'Ask-heavy book — supply stacked above';
  return 'Balanced book — no clear depth bias';
};

const spreadNote = (bps: number): string => {
  if (bps > 5) return 'wide spread, thinner liquidity';
  if (bps < 1) return 'tight spread';
  return 'normal spread';
};

const flowNote = (bias: MicrostructureView['flowBias']): string => {
  if (bias === 'BUY') return 'tape leaning buy';
  if (bias === 'SELL') return 'tape leaning sell';
  return 'neutral tape flow';
};

const wallNote = (
  micro: MicrostructureView,
  bids: readonly BookLevel[],
  asks: readonly BookLevel[]
): string => {
  const bestBid = bids[0]?.price;
  const bestAsk = asks[0]?.price;
  if (!bestBid || !bestAsk) return 'no dominant wall at touch';
  if (micro.bidDepth > micro.askDepth * 1.35) return `support near ${fmtPrice(bestBid)}`;
  if (micro.askDepth > micro.bidDepth * 1.35) return `resistance near ${fmtPrice(bestAsk)}`;
  return 'no dominant wall at touch';
};

const depthCommentary = (
  micro: MicrostructureView | undefined,
  bids: readonly BookLevel[],
  asks: readonly BookLevel[]
): string => {
  if (!micro) return 'Awaiting aggregate depth…';
  return [
    bookTone(micro.imbalance * 100),
    spreadNote(micro.spreadBps),
    flowNote(micro.flowBias),
    wallNote(micro, bids, asks),
  ].join('; ');
};

const DepthHeader = (p: {
  readonly last?: number;
  readonly mark?: number;
  readonly micro?: MicrostructureView;
}): React.JSX.Element => (
  <Box justifyContent="center" marginBottom={1}>
    <Text>
      <Text bold color="white">{pxLabel('LTP', p.last)}</Text>
      <Text color="gray"> │ </Text>
      <Text bold color="cyan">{pxLabel('MARK', p.mark)}</Text>
      {p.micro ? (
        <>
          <Text color="gray"> │ </Text>
          <Text color="yellow">SPR {p.micro.spreadBps.toFixed(1)}bps</Text>
        </>
      ) : null}
    </Text>
  </Box>
);

const DepthAggregate = (p: {
  readonly micro: MicrostructureView;
  readonly bids: readonly BookLevel[];
  readonly asks: readonly BookLevel[];
}): React.JSX.Element => {
  const bidVol = bookNotional(p.bids);
  const askVol = bookNotional(p.asks);
  return (
    <Box flexDirection="column" marginTop={1}>
      <Text color="gray">
        Book bid {p.micro.bidDepth.toFixed(1)} ({fmtVol(bidVol)}) │ ask {p.micro.askDepth.toFixed(1)} ({fmtVol(askVol)}) │ imb {(p.micro.imbalance * 100).toFixed(0)}% │ tape {fmtVol(p.micro.buyVolume)} / {fmtVol(p.micro.sellVolume)} │ Δ {fmtVol(p.micro.tradeDelta)}
      </Text>
      <Text color="gray" italic wrap="truncate">{depthCommentary(p.micro, p.bids, p.asks)}</Text>
    </Box>
  );
};

export interface DepthLadderProps {
  readonly bids: readonly BookLevel[];
  readonly asks: readonly BookLevel[];
  readonly last?: number;
  readonly mark?: number;
  readonly micro?: MicrostructureView;
}

export const DepthLadder = ({ bids, asks, last, mark, micro }: DepthLadderProps): React.JSX.Element => {
  const topBids = bids.slice(0, DEPTH_LEVELS);
  const topAsks = asks.slice(0, DEPTH_LEVELS);
  const rows = Math.max(topBids.length, topAsks.length, 1);
  const sep = ' │ ';

  return (
    <Box flexDirection="column">
      <DepthHeader last={last} mark={mark} micro={micro} />
      <Text color="gray">
        <Text color="green">{`${'qty'.padStart(W_QTY)} ${'vol'.padStart(W_VOL)} ${'price'.padStart(W_PX)}`}</Text>
        {sep}
        <Text color="red">{`${'price'.padStart(W_PX)} ${'vol'.padStart(W_VOL)} ${'qty'.padStart(W_QTY)}`}</Text>
      </Text>
      {Array.from({ length: rows }, (_, i) => {
        const bid = topBids[i];
        const ask = topAsks[i];
        const left = bid
          ? `${fmtQtyCol(bid.qty)} ${fmtVolCol(levelNotional(bid))} ${fmtPxCol(bid.price)}`
          : `${' '.repeat(leftPad)}`;
        const right = ask
          ? `${fmtPxCol(ask.price)} ${fmtVolCol(levelNotional(ask))} ${fmtQtyCol(ask.qty)}`
          : '';
        return (
          <Text key={`row-${i}`}>
            <Text color="green">{left}</Text>
            <Text color="gray">{sep}</Text>
            <Text color="red">{right}</Text>
          </Text>
        );
      })}
      {micro ? <DepthAggregate micro={micro} bids={bids} asks={asks} /> : null}
    </Box>
  );
};

export const Tape = ({ trades }: { trades: readonly TradePrint[] }): React.JSX.Element => (
  <Box flexDirection="column">
    {trades.slice(-6).reverse().map((t, i) => (
      <Text key={`${t.at}-${i}`} color={t.buyerIsMaker ? 'red' : 'green'}>
        {t.buyerIsMaker ? 'S' : 'B'} {t.qty.toFixed(3)} @ {fmtPrice(t.price)}
      </Text>
    ))}
    {trades.length === 0 && <Text color="gray">waiting for trades…</Text>}
  </Box>
);

export const SymbolRows = ({ symbols }: { symbols: readonly string[] }): React.JSX.Element => {
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
    const t = setInterval(() => setTick((n) => n + 1), 500);
    return (): void => clearInterval(t);
  }, [focusSymbol]);
  const focus = getKernel().marketStore.snapshot(focusSymbol);

  return (
    <Box flexDirection="column">
      <Text bold color="cyan">📊 Kernel Dashboard</Text>
      <Text color="gray">Stream <Text color={streamLive ? 'green' : 'yellow'}>{streamLive ? 'LIVE' : 'REST'}</Text> │ Focus <Text color="yellow">{focusSymbol}</Text></Text>
      <Box marginY={1}><SymbolRows symbols={symbols} /></Box>
      <Box flexDirection="row">
        <Box width="50%" flexDirection="column" paddingRight={1}>
          <Text bold color="yellow">Depth</Text>
          {focus?.bids.length ? (
            <DepthLadder bids={focus.bids} asks={focus.asks} last={focus.last} mark={focus.mark} micro={focus.microstructure} />
          ) : <Text color="gray">depth unavailable</Text>}
        </Box>
        <Box width="50%" flexDirection="column">
          <Text bold color="yellow">Tape</Text>
          <LiveTape symbol={focusSymbol} />
        </Box>
      </Box>
      <Box marginTop={1} flexDirection="column">
        <Text bold color="cyan">Activity</Text>
        {activity.length === 0 ? <Text color="gray">/scan logs pipeline results here</Text>
          : activity.slice(0, 6).map((a) => <Text key={a.id} color="gray" wrap="truncate">[{a.at}] {a.text}</Text>)}
      </Box>
    </Box>
  );
};
