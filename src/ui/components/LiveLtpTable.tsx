import React, { useEffect, useMemo, useState } from 'react';
import { Box, Text } from 'ink';
import { Table, type TableColumn } from '../../components/ui/table/index.js';
import { getKernel } from '../../kernel.js';
import { fmtPrice } from '../KernelDashboard.js';
import { kernelWatchSymbols } from '../../kernel-streams.js';

const STALE_MS = 5_000;

let globalTick = 0;
const subscribers = new Set<() => void>();
let globalTimer: NodeJS.Timeout | null = null;

const ensureTimer = (): void => {
  if (globalTimer) return;
  globalTimer = setInterval(() => {
    globalTick += 1;
    for (const sub of subscribers) sub();
  }, 1000);
};

const releaseTimer = (): void => {
  if (subscribers.size === 0 && globalTimer) {
    clearInterval(globalTimer);
    globalTimer = null;
  }
};

export const useLiveTick = (): number => {
  const [tick, setTick] = useState(globalTick);
  useEffect(() => {
    const onTick = (): void => setTick(globalTick);
    subscribers.add(onTick);
    ensureTimer();
    return (): void => {
      subscribers.delete(onTick);
      releaseTimer();
    };
  }, []);
  return tick;
};

export const liveQuote = (symbol: string): LtpQuote => {
  const kernel = getKernel();
  const q = kernel.marketStore.peekQuote(symbol);
  if (!q) return { live: false };
  const stale = (kernel.marketStore.stalenessMs(symbol) ?? Infinity) > STALE_MS;
  const ltp = q.last ?? q.mark ?? (q.bid !== undefined && q.ask !== undefined ? (q.bid + q.ask) / 2 : undefined);
  return { ltp, bid: q.bid, ask: q.ask, mark: q.mark, live: !stale && ltp !== undefined };
};

export type LtpQuote = {
  readonly ltp?: number;
  readonly bid?: number;
  readonly ask?: number;
  readonly mark?: number;
  readonly live: boolean;
};

export type LtpTableRow = {
  symbol: string;
  ltp: string;
  bid: string;
  ask: string;
  mark: string;
  status: string;
};

const moneyCell = (n?: number, symbol?: string): string =>
  (n !== undefined && Number.isFinite(n) ? `$${fmtPrice(n, symbol)}` : '—');

export const toLtpTableRow = (symbol: string, quote: LtpQuote, isAnchor: boolean): LtpTableRow => {
  const status = isAnchor ? 'ANCHOR' : quote.live ? 'LIVE' : quote.ltp !== undefined ? 'STALE' : 'WAIT';
  return {
    symbol,
    ltp: moneyCell(quote.ltp, symbol),
    bid: moneyCell(quote.bid, symbol),
    ask: moneyCell(quote.ask, symbol),
    mark: moneyCell(quote.mark, symbol),
    status,
  };
};

const LTP_COLUMNS: TableColumn<LtpTableRow>[] = [
  { key: 'symbol', header: 'SYMBOL' },
  { key: 'ltp', header: 'LTP', align: 'right' },
  { key: 'bid', header: 'BID', align: 'right' },
  { key: 'ask', header: 'ASK', align: 'right' },
  { key: 'mark', header: 'MARK', align: 'right' },
  { key: 'status', header: 'STATUS' },
];

export const LiveLtpTable = ({ hideHeader }: { readonly hideHeader?: boolean } = {}): React.JSX.Element => {
  useLiveTick();
  const symbols = useMemo(() => kernelWatchSymbols(), []);
  const traded = useMemo(() => new Set(
    (process.env.KERNEL_SYMBOLS ?? 'SOLUSDT,ETHUSDT,XRPUSDT').split(',').map((s) => s.trim().toUpperCase())
  ), []);
  const data = symbols.map((sym) =>
    toLtpTableRow(sym, liveQuote(sym), sym === 'BTCUSDT' && !traded.has('BTCUSDT'))
  );

  return (
    <Box flexDirection="column">
      {!hideHeader && (
        <Box justifyContent="space-between">
          <Text bold color="cyan">LIVE LTP — ALL SYMBOLS</Text>
          <Text color="gray">WS miniTicker + bookTicker</Text>
        </Box>
      )}
      <Table data={data} columns={LTP_COLUMNS} />
    </Box>
  );
};
