import React, { useEffect, useMemo } from 'react';
import { Box, Text } from 'ink';
import { getKernel } from '../../kernel.js';
import type { BrokerPosition } from '../../infrastructure/broker/broker.js';
import type { ActivityTimelineItem } from '../types.js';
import type { MonitoredMarket, ScanOpportunity } from '../scan-opportunities.js';
import { OpportunityTable } from '../components/OpportunityTable.js';
import { DepthLadder } from '../KernelDashboard.js';
import { LiveLtpTable, useLiveTick } from '../components/LiveLtpTable.js';
import { LiveTape } from '../components/LiveTape.js';
import { TranscriptStrip } from '../components/TranscriptStrip.js';
import { TraderBriefPanel } from '../components/TraderBriefPanel.js';
import type { TranscriptEntry } from '../transcript.js';
import { buildTraderBrief } from '../overview-brief.js';
import type { PipelineSnapshots } from '../pipeline-view.js';
import { kernelWatchSymbols } from '../../kernel-streams.js';
import { ensureSymbolTracked } from '../../engines/market-hydrate.js';

export interface OverviewViewProps {
  readonly selectedIndex: number;
  readonly positions: readonly BrokerPosition[];
  readonly timeline: readonly ActivityTimelineItem[];
  readonly focusSymbol: string;
  readonly opportunities: readonly ScanOpportunity[];
  readonly markets?: readonly MonitoredMarket[];
  readonly isScanning?: boolean;
  readonly transcript?: readonly TranscriptEntry[];
  readonly pipelineSnapshots?: PipelineSnapshots;
}

const DepthAndTape = ({ symbol }: { readonly symbol: string }): React.JSX.Element => {
  useLiveTick(200);
  const snap = getKernel().marketStore.snapshot(symbol);
  return (
    <Box flexDirection="row" marginTop={1}>
      <Box width="50%" flexDirection="column" paddingRight={1}>
        <Text bold color="yellow">Depth ({symbol})</Text>
        {snap?.bids.length ? (
          <DepthLadder bids={snap.bids} asks={snap.asks} last={snap.last} mark={snap.mark} micro={snap.microstructure} />
        ) : <Text color="gray">depth streaming…</Text>}
      </Box>
      <Box width="50%" flexDirection="column">
        <Text bold color="yellow">Tape ({symbol})</Text>
        <Text color="gray">WS aggTrade + REST refresh</Text>
        <LiveTape symbol={symbol} />
      </Box>
    </Box>
  );
};

const MarketWatchPanel = ({ focusSymbol }: { readonly focusSymbol: string }): React.JSX.Element => {
  useLiveTick();
  const symbols = useMemo(() => kernelWatchSymbols(), []);
  useEffect(() => {
    void ensureSymbolTracked(focusSymbol);
    for (const sym of symbols) void ensureSymbolTracked(sym);
  }, [focusSymbol, symbols]);
  return (
    <Box flexDirection="column" gap={0}>
      <LiveLtpTable />
      <Text color="gray">{'─'.repeat(Math.max(20, (process.stdout.columns || 80) - 6))}</Text>
      <Box justifyContent="space-between" marginTop={1}>
        <Text bold color="cyan">FOCUS — DEPTH & TAPE</Text>
        <Text color="gray">/focus <Text bold color="yellow">{focusSymbol}</Text></Text>
      </Box>
      <DepthAndTape symbol={focusSymbol} />
    </Box>
  );
};

const PositionsSummary = ({ positions }: { positions: readonly BrokerPosition[] }): React.JSX.Element => (
  <Box flexDirection="column">
    <Text bold color="cyan">POSITIONS ({positions.length}/2 MAX)</Text>
    {positions.length === 0 ? (
      <Text color="gray" italic>No open positions under active management.</Text>
    ) : (
      positions.map((p) => {
        const upnl = p.unrealizedPnl ?? 0;
        const pColor = upnl >= 0 ? 'green' : 'red';
        const sign = upnl >= 0 ? '+' : '';
        return (
          <Text key={p.pair}>
            ● {p.pair} <Text bold color={p.side === 'long' ? 'green' : 'red'}>{p.side.toUpperCase()}</Text> size: {p.size} @ {p.entryPrice.toFixed(2)} | mark: {p.markPrice?.toFixed(2) ?? '...'} | PnL: <Text color={pColor}>{sign}${upnl.toFixed(2)}</Text>
          </Text>
        );
      })
    )}
  </Box>
);

export const OverviewView = (p: OverviewViewProps): React.JSX.Element => {
  useLiveTick();
  const brief = buildTraderBrief(p.focusSymbol, p.pipelineSnapshots ?? {}, p.opportunities);

  return (
  <Box flexDirection="column" gap={1} paddingX={1}>
    <TraderBriefPanel brief={brief} />
    <Text color="gray">{'─'.repeat(Math.max(20, (process.stdout.columns || 80) - 6))}</Text>
    <MarketWatchPanel focusSymbol={p.focusSymbol} />
    <Text color="gray">{'─'.repeat(Math.max(20, (process.stdout.columns || 80) - 6))}</Text>
    <Box flexDirection="column">
      <OpportunityTable
        rows={p.opportunities}
        markets={p.markets}
        isScanning={p.isScanning}
        selectedIndex={p.selectedIndex}
        compact
      />
    </Box>
    <Text color="gray">{'─'.repeat(Math.max(20, (process.stdout.columns || 80) - 6))}</Text>
    <PositionsSummary positions={p.positions} />
    {p.transcript ? <TranscriptStrip entries={p.transcript} limit={2} /> : null}
  </Box>
  );
};
