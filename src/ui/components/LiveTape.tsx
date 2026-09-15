import React, { useEffect, useState } from 'react';
import { Box, Text } from 'ink';
import { getKernel } from '../../kernel.js';
import type { TradePrint } from '../../domain/market/microstructure.js';
import { refreshSymbolTape } from '../../engines/market-hydrate.js';
import { fmtPrice } from '../KernelDashboard.js';

const tradeKey = (t: TradePrint, i: number): string => `${t.at}:${t.price}:${t.qty}:${t.buyerIsMaker ? 'S' : 'B'}:${i}`;

const fmtTime = (at: number): string =>
  new Date(at).toLocaleTimeString('en-IN', { hour12: false });

const TapeRows = ({ trades, symbol }: {
  readonly trades: readonly TradePrint[];
  readonly symbol: string;
}): React.JSX.Element => (
  <Box flexDirection="column">
    {trades.slice(-8).reverse().map((t, i) => (
      <Text key={tradeKey(t, i)} color={t.buyerIsMaker ? 'red' : 'green'}>
        {fmtTime(t.at)} {t.buyerIsMaker ? 'S' : 'B'} {t.qty.toFixed(3)} @ {fmtPrice(t.price, symbol)}
      </Text>
    ))}
    {trades.length === 0 && <Text color="gray">waiting for trades…</Text>}
  </Box>
);

const readTape = (symbol: string): { trades: readonly TradePrint[]; seq: number } => {
  const book = getKernel().marketStore.peekBook(symbol.toUpperCase());
  return { trades: book?.trades ?? [], seq: book?.tradeSeq ?? 0 };
};

export const useLiveTrades = (symbol: string): readonly TradePrint[] => {
  const [view, setView] = useState(readTape(symbol));
  useEffect(() => {
    const sym = symbol.toUpperCase();
    let ticks = 0;
    const sync = (): void => {
      const next = readTape(sym);
      setView((prev) => (prev.seq === next.seq ? prev : next));
    };
    sync();
    const timer = setInterval(() => {
      sync();
      ticks += 1;
      if (ticks % 5 === 0) void refreshSymbolTape(sym).then(sync);
    }, 1000);
    return (): void => clearInterval(timer);
  }, [symbol]);
  return view.trades;
};

export const LiveTape = ({ symbol }: { readonly symbol: string }): React.JSX.Element => (
  <TapeRows trades={useLiveTrades(symbol)} symbol={symbol} />
);
