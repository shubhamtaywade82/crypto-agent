import React from 'react';
import { Box, Text } from 'ink';
import type { MonitoredMarket, ScanOpportunity } from '../scan-opportunities.js';
import { fmtPrice } from '../KernelDashboard.js';
import { liveQuote, useLiveTick } from './LiveLtpTable.js';

const stateColor = (state: string): string => {
  if (state === 'REJECTED' || state === 'HALTED') return 'red';
  if (state === 'READY' || state === 'EXECUTED') return 'green';
  return 'yellow';
};

export interface OpportunityTableProps {
  readonly rows: readonly ScanOpportunity[];
  readonly markets?: readonly MonitoredMarket[];
  readonly isScanning?: boolean;
  readonly selectedIndex: number;
  readonly compact?: boolean;
}

const MarketRow = ({ m, idx, isSel, compact }: {
  readonly m: MonitoredMarket; readonly idx: number; readonly isSel: boolean; readonly compact?: boolean;
}): React.JSX.Element => {
  const trendCol = m.trend === 'BULLISH' ? 'green' : m.trend === 'BEARISH' ? 'red' : 'gray';
  const regCol = m.regime.includes('UP') ? 'green' : m.regime.includes('DOWN') ? 'red' : 'yellow';
  const live = liveQuote(m.symbol);
  const px = live.ltp ?? m.price;
  const priceStr = px > 0 ? `$${fmtPrice(px)}` : '—';
  const liveTag = live.live ? '' : ' *';
  return (
    <Text color={isSel ? 'black' : undefined} backgroundColor={isSel ? 'cyan' : undefined}>
      {isSel ? '>' : ' '} {idx + 1}  {m.symbol.padEnd(10)} {`${priceStr}${liveTag}`.padEnd(compact ? 11 : 14)}
      <Text color={isSel ? 'black' : regCol}>{m.regime.padEnd(compact ? 11 : 14)}</Text>
      <Text color={isSel ? 'black' : trendCol}>{m.trend.padEnd(11)}</Text>
      {!compact && `${String(m.setupsCount).padEnd(8)}`}
      <Text color={isSel ? 'black' : 'gray'}>MONITORING (0/4 passed min 2.5 R:R)</Text>
    </Text>
  );
};

const MonitoredMarketsTable = (p: {
  readonly markets: readonly MonitoredMarket[];
  readonly selectedIndex: number;
  readonly compact?: boolean;
  readonly isScanning?: boolean;
}): React.JSX.Element => {
  useLiveTick();
  const safeIdx = Math.min(p.selectedIndex, p.markets.length - 1);
  const header = p.compact
    ? '   #  SYMBOL     LTP (LIVE)  REGIME     1H TREND   STATUS'
    : '   #  SYMBOL     LTP (LIVE)     REGIME        1H TREND   SETUPS  STATUS';
  return (
    <Box flexDirection="column">
      <Text color="gray">{header}</Text>
      {p.markets.map((m, idx) => (
        <MarketRow key={m.symbol} m={m} idx={idx} isSel={idx === safeIdx} compact={p.compact} />
      ))}
      <Text color="gray" italic>
        {p.isScanning ? '⠋ Scanning markets...' : `Scanned at ${p.markets[0]?.scannedAt ?? 'recently'} │ Watching for structural triggers`}
      </Text>
    </Box>
  );
};

export const OpportunityTable = (p: OpportunityTableProps): React.JSX.Element => {
  if (p.rows.length === 0) {
    if (p.markets && p.markets.length > 0) {
      return <MonitoredMarketsTable markets={p.markets} selectedIndex={p.selectedIndex} compact={p.compact} isScanning={p.isScanning} />;
    }
    if (p.isScanning) {
      return <Text color="yellow">⠋ Initial market scan in progress... analyzing order book & MTF structure</Text>;
    }
    return <Text color="gray" italic>Initializing market scan... run /scan or wait for auto-scan</Text>;
  }
  const safeIdx = Math.min(p.selectedIndex, p.rows.length - 1);
  const header = p.compact
    ? '#  SYMBOL    SETUP             TF   CONF   REGIME    R:R   STATE'
    : '   #  SYMBOL    DIR    SETUP             TF   CONF   REGIME     R:R   STATE';

  return (
    <Box flexDirection="column">
      <Text color="gray">{header}</Text>
      {p.rows.map((c, idx) => {
        const isSel = idx === safeIdx;
        const dirColor = c.direction === 'LONG' ? 'green' : 'red';
        const stColor = stateColor(c.state);
        return (
          <Text key={`${c.symbol}-${c.setup}`} color={isSel ? 'black' : undefined} backgroundColor={isSel ? 'cyan' : undefined}>
            {isSel ? '>' : ' '} {idx + 1}  {c.symbol.padEnd(9)}
            {!p.compact && <Text color={isSel ? 'black' : dirColor}>{c.direction.padEnd(6)}</Text>}
            {` ${c.setup.padEnd(17)} ${c.tf.padEnd(4)} ${c.confidence.toFixed(2)}   ${c.regime.padEnd(p.compact ? 9 : 10)} ${c.rr.toFixed(1)}   `}
            <Text color={isSel ? 'black' : stColor}>{c.state}</Text>
          </Text>
        );
      })}
    </Box>
  );
};

export const OpportunityDetail = (p: { readonly row: ScanOpportunity }): React.JSX.Element => (
  <Box flexDirection="column">
    <Text bold color="yellow">SELECTED: {p.row.symbol} ({p.row.direction})</Text>
    <Text color="gray">├─ Setup:        <Text color="white">{p.row.setup} ({p.row.tf})</Text></Text>
    <Text color="gray">├─ Evidence MTF: <Text color="white">{p.row.mtf}</Text></Text>
    <Text color="gray">├─ Thesis:       <Text color="white">"{p.row.thesis}"</Text></Text>
    <Text color="gray">└─ Scanned:      <Text color="white">{p.row.scannedAt} │ conf={p.row.confidence.toFixed(2)} │ R:R={p.row.rr.toFixed(1)} │ {p.row.state}</Text></Text>
  </Box>
);

export const MarketDetail = (p: { readonly market: MonitoredMarket }): React.JSX.Element => (
  <Box flexDirection="column">
    <Text bold color="yellow">MONITORED: {p.market.symbol}</Text>
    <Text color="gray">├─ Mark Price:   <Text color="white">${p.market.price.toFixed(2)}</Text></Text>
    <Text color="gray">├─ Regime:       <Text color="white">{p.market.regime}</Text></Text>
    <Text color="gray">├─ 1H Trend:     <Text color="white">{p.market.trend}</Text></Text>
    <Text color="gray">├─ Setups:       <Text color="white">{p.market.setupsCount} setups passed risk gate (min 2.5 R:R)</Text></Text>
    <Text color="gray">└─ Last Scan:    <Text color="white">{p.market.scannedAt} │ Autonomous watcher active</Text></Text>
  </Box>
);
