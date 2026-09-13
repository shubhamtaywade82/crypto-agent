import React from 'react';
import { Box, Text } from 'ink';
import { Spinner } from '../../components/ui/spinner/index.js';
import { Table, type TableColumn } from '../../components/ui/table/index.js';
import type { MonitoredMarket, ScanOpportunity } from '../scan-opportunities.js';
import { fmtPrice } from '../KernelDashboard.js';
import { liveQuote, useLiveTick, type LtpQuote } from './LiveLtpTable.js';

export interface OpportunityTableProps {
  readonly rows: readonly ScanOpportunity[];
  readonly markets?: readonly MonitoredMarket[];
  readonly isScanning?: boolean;
  readonly selectedIndex: number;
  readonly compact?: boolean;
}

export type MarketTableRow = {
  n: string;
  symbol: string;
  ltp: string;
  regime: string;
  trend: string;
  setups?: string;
  status?: string;
};

export type OpportunityTableRow = {
  n: string;
  symbol: string;
  setup: string;
  rr: string;
  state: string;
  direction?: string;
  tf?: string;
  conf?: string;
  regime?: string;
};

const shortSym = (symbol: string, n: number): string => symbol.replace('USDT', '').slice(0, n);

export const toMarketTableRow = (
  m: MonitoredMarket,
  idx: number,
  compact: boolean,
  live: LtpQuote
): MarketTableRow => {
  const px = live.ltp ?? m.price;
  const priceStr = px > 0 ? `$${fmtPrice(px, m.symbol)}` : '—';
  const row: MarketTableRow = {
    n: String(idx + 1),
    symbol: compact ? shortSym(m.symbol, 6) : m.symbol,
    ltp: `${priceStr}${live.live ? '' : '*'}`,
    regime: compact ? m.regime.slice(0, 7) : m.regime,
    trend: compact ? m.trend.slice(0, 4) : m.trend,
  };
  if (compact) return row;
  return { ...row, setups: String(m.setupsCount), status: 'MONITORING' };
};

export const toOpportunityTableRow = (
  c: ScanOpportunity,
  idx: number,
  compact: boolean
): OpportunityTableRow => {
  const base: OpportunityTableRow = {
    n: String(idx + 1),
    symbol: compact ? shortSym(c.symbol, 5) : c.symbol,
    setup: compact ? c.setup.slice(0, 10) : c.setup,
    rr: c.rr.toFixed(1),
    state: compact ? c.state.slice(0, 7) : c.state,
  };
  if (compact) return base;
  return { ...base, direction: c.direction, tf: c.tf, conf: c.confidence.toFixed(2), regime: c.regime };
};

const MARKET_COMPACT: TableColumn<MarketTableRow>[] = [
  { key: 'n', header: '#' },
  { key: 'symbol', header: 'SYM' },
  { key: 'ltp', header: 'LTP', align: 'right' },
  { key: 'regime', header: 'REGIME' },
  { key: 'trend', header: 'TRND' },
];

const MARKET_FULL: TableColumn<MarketTableRow>[] = [
  { key: 'n', header: '#' },
  { key: 'symbol', header: 'SYMBOL' },
  { key: 'ltp', header: 'LTP', align: 'right' },
  { key: 'regime', header: 'REGIME' },
  { key: 'trend', header: 'TREND' },
  { key: 'setups', header: 'SETUPS' },
  { key: 'status', header: 'STATUS' },
];

const OPP_COMPACT: TableColumn<OpportunityTableRow>[] = [
  { key: 'n', header: '#' },
  { key: 'symbol', header: 'SYM' },
  { key: 'setup', header: 'SETUP' },
  { key: 'rr', header: 'R:R', align: 'right' },
  { key: 'state', header: 'STATE' },
];

const OPP_FULL: TableColumn<OpportunityTableRow>[] = [
  { key: 'n', header: '#' },
  { key: 'symbol', header: 'SYMBOL' },
  { key: 'direction', header: 'DIR' },
  { key: 'setup', header: 'SETUP' },
  { key: 'tf', header: 'TF' },
  { key: 'conf', header: 'CONF', align: 'right' },
  { key: 'regime', header: 'REGIME' },
  { key: 'rr', header: 'R:R', align: 'right' },
  { key: 'state', header: 'STATE' },
];

const MonitoredMarketsTable = (p: {
  readonly markets: readonly MonitoredMarket[];
  readonly selectedIndex: number;
  readonly compact?: boolean;
  readonly isScanning?: boolean;
}): React.JSX.Element => {
  useLiveTick();
  const safeIdx = Math.min(p.selectedIndex, p.markets.length - 1);
  const data = p.markets.map((m, idx) => toMarketTableRow(m, idx, Boolean(p.compact), liveQuote(m.symbol)));
  return (
    <Box flexDirection="column">
      <Table
        data={data}
        columns={p.compact ? MARKET_COMPACT : MARKET_FULL}
        framed={!p.compact}
        highlightedIndex={safeIdx < 0 ? undefined : safeIdx}
        maxWidth={p.compact ? 34 : undefined}
      />
      {p.isScanning ? (
        <Spinner label="Scanning markets..." type="dots" />
      ) : (
        <Text color="gray" italic wrap="truncate">
          {p.compact
            ? `Scanned ${p.markets[0]?.scannedAt ?? 'recently'}`
            : `Scanned at ${p.markets[0]?.scannedAt ?? 'recently'} │ Watching for structural triggers`}
        </Text>
      )}
    </Box>
  );
};

const emptyState = (p: OpportunityTableProps): React.JSX.Element => {
  if (p.markets && p.markets.length > 0) {
    return (
      <MonitoredMarketsTable
        markets={p.markets}
        selectedIndex={p.selectedIndex}
        compact={p.compact}
        isScanning={p.isScanning}
      />
    );
  }
  if (p.isScanning) {
    return <Spinner label="Initial market scan in progress... analyzing order book & MTF structure" type="dots" />;
  }
  return <Text color="gray" italic>Initializing market scan... run /scan or wait for auto-scan</Text>;
};

export const OpportunityTable = (p: OpportunityTableProps): React.JSX.Element => {
  if (p.rows.length === 0) return emptyState(p);
  const safeIdx = Math.min(p.selectedIndex, p.rows.length - 1);
  const data = p.rows.map((c, idx) => toOpportunityTableRow(c, idx, Boolean(p.compact)));
  return (
    <Table
      data={data}
      columns={p.compact ? OPP_COMPACT : OPP_FULL}
      framed={!p.compact}
      highlightedIndex={safeIdx < 0 ? undefined : safeIdx}
      maxWidth={p.compact ? 34 : undefined}
    />
  );
};

export const OpportunityDetail = (p: { readonly row: ScanOpportunity }): React.JSX.Element => (
  <Box flexDirection="column">
    <Text bold color="yellow">SELECTED: {p.row.symbol} ({p.row.direction})</Text>
    <Text color="gray">Setup: <Text color="white">{p.row.setup} ({p.row.tf})</Text></Text>
    <Text color="gray">Evidence MTF: <Text color="white">{p.row.mtf}</Text></Text>
    <Text color="gray">Thesis: <Text color="white">"{p.row.thesis}"</Text></Text>
    <Text color="gray">Scanned: <Text color="white">{p.row.scannedAt} │ conf={p.row.confidence.toFixed(2)} │ R:R={p.row.rr.toFixed(1)} │ {p.row.state}</Text></Text>
  </Box>
);

export const MarketDetail = (p: { readonly market: MonitoredMarket }): React.JSX.Element => (
  <Box flexDirection="column">
    <Text bold color="yellow">MONITORED: {p.market.symbol}</Text>
    <Text color="gray">Mark Price: <Text color="white">${fmtPrice(p.market.price, p.market.symbol)}</Text></Text>
    <Text color="gray">Regime: <Text color="white">{p.market.regime}</Text></Text>
    <Text color="gray">1H Trend: <Text color="white">{p.market.trend}</Text></Text>
    <Text color="gray">Setups: <Text color="white">{p.market.setupsCount} setups passed risk gate (min 2.5 R:R)</Text></Text>
    <Text color="gray">Last Scan: <Text color="white">{p.market.scannedAt} │ Autonomous watcher active</Text></Text>
  </Box>
);
