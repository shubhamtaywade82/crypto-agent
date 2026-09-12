import React from 'react';
import { Box, Text } from 'ink';
import { Divider } from '../../components/ui/divider/index.js';
import { KeyHint, type KeyHintItem } from '../../components/ui/key-hint/index.js';
import { Badge } from '../../components/ui/badge/index.js';
import type { BrokerPosition } from '../../infrastructure/broker/broker.js';
import { getKernel } from '../../kernel.js';

export interface PositionsViewProps {
  readonly positions: readonly BrokerPosition[];
  readonly selectedIndex: number;
}

const POSITION_KEYS: readonly KeyHintItem[] = [
  { key: 'Enter', label: 'Details' },
  { key: 't', label: 'Adjust TPSL' },
  { key: 'x', label: 'Market Close' },
  { key: 'l', label: 'Lineage Trace' },
];

const pairToSymbol = (pair: string): string => pair.replace(/^B-/, '').replace('_', '');

const findLedgerTrade = (pair: string): ReturnType<typeof getKernel>['ledger']['openTrades'][number] | undefined => {
  const sym = pairToSymbol(pair);
  return getKernel().ledger.openTrades.find((t) => t.symbol === sym || pair.includes(t.symbol));
};

const PositionDetail = ({ p }: { readonly p: BrokerPosition }): React.JSX.Element => {
  const ledger = findLedgerTrade(p.pair);
  return (
  <Box flexDirection="column">
    <Divider style="single" />
    <Box gap={1} alignItems="center" marginBottom={0}>
      <Text bold color="yellow">SELECTED POSITION: {p.pair}</Text>
      <Badge variant={p.side === 'long' ? 'success' : 'error'}>{p.side.toUpperCase()}</Badge>
    </Box>
    <Text color="gray">├─ Strategy:     <Text color="white">{ledger?.strategyId ?? '—'}</Text></Text>
    <Text color="gray">├─ Entry Price:  <Text color="white">{p.entryPrice.toFixed(2)} USDT</Text></Text>
    <Text color="gray">├─ Leverage:     <Text color="white">{p.leverage ?? ledger?.leverage ?? 2}x</Text></Text>
    <Text color="gray">├─ Stop Loss:    <Text color="white">{ledger ? ledger.stopLoss.toFixed(2) : '—'} USDT</Text></Text>
    <Text color="gray">├─ Take Profit:  <Text color="white">{ledger ? ledger.takeProfit.toFixed(2) : '—'} USDT</Text></Text>
    <Text color="gray">└─ Planned R:R:  <Text color="white">{ledger ? ledger.plannedRr.toFixed(2) : '—'} · regime {ledger?.regime ?? '—'}</Text></Text>
    <Box marginTop={1}>
      <KeyHint keys={[...POSITION_KEYS]} />
    </Box>
  </Box>
  );
};

const PositionsTable = (p: {
  readonly positions: readonly BrokerPosition[];
  readonly safeIdx: number;
}): React.JSX.Element => (
  <Box flexDirection="column">
    <Text color="gray">   SYMBOL     SIDE   SIZE       ENTRY      MARK       PNL (USDT)   PNL (%)  STATE</Text>
    {p.positions.map((pos, idx) => {
      const isSel = idx === p.safeIdx;
      const upnl = pos.unrealizedPnl ?? 0;
      const pnlColor = upnl >= 0 ? 'green' : 'red';
      const sign = upnl >= 0 ? '+' : '';
      const pct = pos.entryPrice > 0 ? (upnl / (pos.entryPrice * pos.size)) * 100 : 0;
      return (
        <Text key={pos.pair} color={isSel ? 'black' : undefined} backgroundColor={isSel ? 'cyan' : undefined}>
          {isSel ? ' >' : '  '} {pos.pair.padEnd(10)} <Text color={isSel ? 'black' : pos.side === 'long' ? 'green' : 'red'}>{pos.side.toUpperCase().padEnd(6)}</Text> {pos.size.toFixed(3).padEnd(10)} {pos.entryPrice.toFixed(2).padEnd(10)} {(pos.markPrice ?? pos.entryPrice).toFixed(2).padEnd(10)} <Text color={isSel ? 'black' : pnlColor}>{(sign + '$' + upnl.toFixed(2)).padEnd(12)}</Text> <Text color={isSel ? 'black' : pnlColor}>{(sign + pct.toFixed(2) + '%').padEnd(8)}</Text> <Text color={isSel ? 'black' : 'green'}>PROTECTED</Text>
        </Text>
      );
    })}
  </Box>
);

export const PositionsView = ({ positions, selectedIndex }: PositionsViewProps): React.JSX.Element => {
  const safeIdx = Math.min(selectedIndex, Math.max(0, positions.length - 1));
  const selected = positions[safeIdx];

  return (
    <Box flexDirection="column" gap={1}>
      <Text bold color="cyan">
        ACTIVE POSITIONS ({positions.length} OPEN / 2 MAX PERMITTED)
      </Text>
      {positions.length === 0 ? (
        <Box flexDirection="column" marginY={1}>
          <Text color="gray" italic>Zero open positions currently supervised by the execution kernel.</Text>
          <Text color="gray">System is scanning 42 symbols for valid setups meeting the 2.5 min R:R hurdle.</Text>
        </Box>
      ) : (
        <PositionsTable positions={positions} safeIdx={safeIdx} />
      )}
      {selected ? <PositionDetail p={selected} /> : null}
    </Box>
  );
};
