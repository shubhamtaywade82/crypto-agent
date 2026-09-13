import React, { useEffect, useState } from 'react';
import { Box, Text } from 'ink';
import { getKernel } from '../kernel.js';
import type { BookLevel, MicrostructureView, TradePrint } from '../domain/market/microstructure.js';
import { ensureSymbolTracked } from '../engines/market-hydrate.js';
import { LiveTape } from './components/LiveTape.js';

import type { Decimal } from 'decimal.js';
import { formatPrecision } from '../domain/primitives.js';

export interface ActivityEntry {
  readonly id: string;
  readonly at: string;
  readonly text: string;
}

const DEPTH_LEVELS = 5;
const W_QTY = 9;
const W_VOL = 8;
const W_PX = 11;

export const fmtPrice = (
  p: number | string | Decimal,
  precisionOrSymbol?: number | string
): string => formatPrecision(p, precisionOrSymbol);

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
const fmtPxCol = (p: number, sym?: string): string => fmtPrice(p, sym).padStart(W_PX);
const leftPad = W_QTY + 1 + W_VOL + 1 + W_PX;

export const quotePrice = (q: {
  readonly last?: number; readonly mark?: number;
  readonly bid?: number; readonly ask?: number;
} | undefined): number | undefined => {
  if (!q) return undefined;
  if (q.last !== undefined) return q.last;
  if (q.mark !== undefined) return q.mark;
  if (q.bid !== undefined && q.ask !== undefined) return (q.bid + q.ask) / 2;
  return undefined;
};

const pxLabel = (label: string, value: number | undefined, sym?: string): string =>
  value !== undefined ? `${label} ${fmtPrice(value, sym)}` : `${label} —`;

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
  asks: readonly BookLevel[],
  sym?: string
): string => {
  const bestBid = bids[0]?.price;
  const bestAsk = asks[0]?.price;
  if (!bestBid || !bestAsk) return 'no dominant wall at touch';
  if (micro.bidDepth > micro.askDepth * 1.35) return `support near ${fmtPrice(bestBid, sym)}`;
  if (micro.askDepth > micro.bidDepth * 1.35) return `resistance near ${fmtPrice(bestAsk, sym)}`;
  return 'no dominant wall at touch';
};

const depthCommentary = (
  micro: MicrostructureView | undefined,
  bids: readonly BookLevel[],
  asks: readonly BookLevel[],
  sym?: string
): string => {
  if (!micro) return 'Awaiting aggregate depth…';
  return [
    bookTone(micro.imbalance * 100),
    spreadNote(micro.spreadBps),
    flowNote(micro.flowBias),
    wallNote(micro, bids, asks, sym),
  ].join('; ');
};

const DepthHeader = (p: {
  readonly last?: number;
  readonly mark?: number;
  readonly micro?: MicrostructureView;
  readonly symbol?: string;
}): React.JSX.Element => (
  <Box justifyContent="center" marginBottom={1}>
    <Text>
      <Text bold color="white">{pxLabel('LTP', p.last, p.symbol)}</Text>
      <Text color="gray"> │ </Text>
      <Text bold color="cyan">{pxLabel('MARK', p.mark, p.symbol)}</Text>
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
  readonly symbol?: string;
}): React.JSX.Element => {
  const bidVol = bookNotional(p.bids);
  const askVol = bookNotional(p.asks);
  return (
    <Box flexDirection="column" marginTop={1}>
      <Text color="gray">
        Book bid {p.micro.bidDepth.toFixed(1)} ({fmtVol(bidVol)}) │ ask {p.micro.askDepth.toFixed(1)} ({fmtVol(askVol)}) │ imb {(p.micro.imbalance * 100).toFixed(0)}% │ tape {fmtVol(p.micro.buyVolume)} / {fmtVol(p.micro.sellVolume)} │ Δ {fmtVol(p.micro.tradeDelta)}
      </Text>
      <Text color="gray" italic wrap="truncate">{depthCommentary(p.micro, p.bids, p.asks, p.symbol)}</Text>
    </Box>
  );
};

export interface DepthLadderProps {
  readonly bids: readonly BookLevel[];
  readonly asks: readonly BookLevel[];
  readonly last?: number;
  readonly mark?: number;
  readonly micro?: MicrostructureView;
  readonly symbol?: string;
}

const DepthLevelRow = ({ bid, ask, sep, symbol }: {
  readonly bid?: BookLevel;
  readonly ask?: BookLevel;
  readonly sep: string;
  readonly symbol?: string;
}): React.JSX.Element => {
  const left = bid
    ? `${fmtQtyCol(bid.qty)} ${fmtVolCol(levelNotional(bid))} ${fmtPxCol(bid.price, symbol)}`
    : `${' '.repeat(leftPad)}`;
  const right = ask
    ? `${fmtPxCol(ask.price, symbol)} ${fmtVolCol(levelNotional(ask))} ${fmtQtyCol(ask.qty)}`
    : '';
  return (
    <Text>
      <Text color="green">{left}</Text>
      <Text color="gray">{sep}</Text>
      <Text color="red">{right}</Text>
    </Text>
  );
};

export const DepthLadder = ({ bids, asks, last, mark, micro, symbol }: DepthLadderProps): React.JSX.Element => {
  const topBids = bids.slice(0, DEPTH_LEVELS);
  const topAsks = asks.slice(0, DEPTH_LEVELS);
  const mid = topBids[0] && topAsks[0] ? (topBids[0].price + topAsks[0].price) / 2 : undefined;
  const effectiveLast = last ?? mid;
  const effectiveMark = mark ?? effectiveLast;
  const rows = Math.max(topBids.length, topAsks.length, 1);
  const sep = ' │ ';

  return (
    <Box flexDirection="column">
      <DepthHeader last={effectiveLast} mark={effectiveMark} micro={micro} symbol={symbol} />
      <Text color="gray">
        <Text color="green">{`${'qty'.padStart(W_QTY)} ${'vol'.padStart(W_VOL)} ${'price'.padStart(W_PX)}`}</Text>
        {sep}
        <Text color="red">{`${'price'.padStart(W_PX)} ${'vol'.padStart(W_VOL)} ${'qty'.padStart(W_QTY)}`}</Text>
      </Text>
      {Array.from({ length: rows }, (_, i) => (
        <DepthLevelRow key={`row-${i}`} bid={topBids[i]} ask={topAsks[i]} sep={sep} symbol={symbol} />
      ))}
      {micro ? <DepthAggregate micro={micro} bids={bids} asks={asks} symbol={symbol} /> : null}
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
        const book = kernel.marketStore.peekBook(sym);
        const q = kernel.marketStore.peekQuote(sym);
        const m = book?.microstructure;
        const px = quotePrice(q);
        const stale = q ? kernel.marketStore.stalenessMs(sym) : undefined;
        return (
          <Text key={sym} wrap="truncate">
            <Text bold>{sym.replace('USDT', '')}</Text> {px !== undefined ? fmtPrice(px, sym) : '…'}
            {m ? <Text color="gray"> spr {m.spreadBps.toFixed(1)}bps imb {(m.imbalance * 100).toFixed(0)}% {m.flowBias}</Text>
              : <Text color="gray"> {book ? 'awaiting depth' : 'not subscribed'}</Text>}
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
  const focus = getKernel().marketStore.peekBook(focusSymbol);

  return (
    <Box flexDirection="column">
      <Text bold color="cyan">📊 Kernel Dashboard</Text>
      <Text color="gray">Stream <Text color={streamLive ? 'green' : 'yellow'}>{streamLive ? 'LIVE' : 'REST'}</Text> │ Focus <Text color="yellow">{focusSymbol}</Text></Text>
      <Box marginY={1}><SymbolRows symbols={symbols} /></Box>
      <Box flexDirection="row">
        <Box width="50%" flexDirection="column" paddingRight={1}>
          <Text bold color="yellow">Depth</Text>
          {focus?.bids.length ? (
            <DepthLadder bids={focus.bids} asks={focus.asks} last={focus.last} mark={focus.mark} micro={focus.microstructure} symbol={focusSymbol} />
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
