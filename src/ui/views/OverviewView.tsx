import React, { useEffect, useMemo } from 'react';
import { Box, Text } from 'ink';
import { getKernel } from '../../kernel.js';
import type { BrokerPosition } from '../../infrastructure/broker/broker.js';
import type { MonitoredMarket, ScanOpportunity } from '../scan-opportunities.js';
import { OpportunityTable } from '../components/OpportunityTable.js';
import { DepthLadder } from '../KernelDashboard.js';
import { LiveLtpTable, useLiveTick } from '../components/LiveLtpTable.js';
import { LiveTape } from '../components/LiveTape.js';
import { AgentConsoleFeed } from '../components/TranscriptStrip.js';
import { TraderBriefPanel } from '../components/TraderBriefPanel.js';
import type { TranscriptEntry } from '../transcript.js';
import { buildTraderBrief } from '../overview-brief.js';
import type { PipelineSnapshots } from '../pipeline-view.js';
import { kernelWatchSymbols } from '../../kernel-streams.js';
import { ensureSymbolTracked } from '../../engines/market-hydrate.js';
import type { usePortfolio } from '../app-hooks.js';
import { deriveCircuitState } from '../../domain/risk/risk-config.js';

export interface OverviewViewProps {
  readonly selectedIndex: number;
  readonly positions: readonly BrokerPosition[];
  readonly focusSymbol: string;
  readonly opportunities: readonly ScanOpportunity[];
  readonly markets?: readonly MonitoredMarket[];
  readonly isScanning?: boolean;
  readonly transcript?: readonly TranscriptEntry[];
  readonly pipelineSnapshots?: PipelineSnapshots;
  readonly streamLive?: boolean;
  readonly autoEnabled?: boolean;
  readonly port?: ReturnType<typeof usePortfolio>;
}

const rule = (): string => '─'.repeat(Math.max(20, (process.stdout.columns || 80) - 6));

const DepthAndTape = ({ symbol }: { readonly symbol: string }): React.JSX.Element => {
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
  const symbols = useMemo(() => kernelWatchSymbols(), []);
  useEffect(() => {
    void ensureSymbolTracked(focusSymbol);
    for (const sym of symbols) void ensureSymbolTracked(sym);
  }, [focusSymbol, symbols]);
  return (
    <Box flexDirection="column" gap={0}>
      <Box justifyContent="space-between" marginBottom={0}>
        <Text bold color="cyan">MARKET WATCH — LTP · ORDER BOOK · TAPE</Text>
        <Text color="gray">/focus <Text bold color="yellow">{focusSymbol}</Text></Text>
      </Box>
      <LiveLtpTable />
      <DepthAndTape symbol={focusSymbol} />
    </Box>
  );
};

const StatusDot = ({ ok, label }: { readonly ok: boolean; readonly label: string }): React.JSX.Element => (
  <Text color="gray">● {label}: <Text color={ok ? 'green' : 'red'}>{ok ? 'OK' : 'STALE'}</Text></Text>
);

const SidebarPositions = ({ positions }: { readonly positions: readonly BrokerPosition[] }): React.JSX.Element => (
  <Box flexDirection="column">
    <Text bold color="yellow">RECENT POSITIONS</Text>
    {positions.length === 0 ? <Text color="gray" italic>None open</Text> : positions.map((pos) => {
      const upnl = pos.unrealizedPnl ?? 0;
      const sign = upnl >= 0 ? '+' : '';
      return (
        <Text key={pos.pair} wrap="truncate">
          {pos.pair} <Text color={pos.side === 'long' ? 'green' : 'red'}>{pos.side.toUpperCase()}</Text>
          {' '}<Text color={upnl >= 0 ? 'green' : 'red'}>{sign}${upnl.toFixed(2)}</Text>
        </Text>
      );
    })}
  </Box>
);

const SidebarSystemStatus = ({ streamLive, halted, circuit }: {
  readonly streamLive: boolean;
  readonly halted: boolean;
  readonly circuit: string;
}): React.JSX.Element => (
  <Box flexDirection="column">
    <Text bold color="yellow">SYSTEM STATUS</Text>
    <StatusDot ok={true} label="Agent Runtime" />
    <StatusDot ok={streamLive} label="Binance MD WS" />
    <StatusDot ok={!halted} label="Execution" />
    <Text color="gray">● Circuit: <Text color="white">{circuit}</Text></Text>
  </Box>
);

const OverviewSidebar = (p: {
  readonly positions: readonly BrokerPosition[];
  readonly opportunities: readonly ScanOpportunity[];
  readonly markets?: readonly MonitoredMarket[];
  readonly isScanning?: boolean;
  readonly streamLive?: boolean;
  readonly port?: ReturnType<typeof usePortfolio>;
}): React.JSX.Element => {
  const k = getKernel();
  const snap = p.port ?? k.portfolio.peek();
  const circuit = deriveCircuitState(snap.dailyLossPercent, snap.drawdownPercent, snap.lossStreak, k.limits);

  return (
    <Box flexDirection="column" width={38} flexShrink={0} gap={1}>
      <SidebarSystemStatus streamLive={p.streamLive ?? false} halted={k.killSwitch.halted} circuit={circuit} />
      <Box flexDirection="column">
        <Text bold color="yellow">PORTFOLIO</Text>
        <Text color="gray">Eq <Text bold color="white">${snap.equity.toFixed(2)}</Text></Text>
        <Text color="gray">Today <Text color={snap.dailyRealizedPnl >= 0 ? 'green' : 'red'}>{snap.dailyRealizedPnl >= 0 ? '+' : ''}${snap.dailyRealizedPnl.toFixed(2)}</Text></Text>
        <Text color="gray">Pos <Text color="white">{snap.openPositions}/{k.limits.maxConcurrentPositions}</Text> │ Lev <Text color="white">{k.limits.maxLeverage}x</Text></Text>
      </Box>
      <Box flexDirection="column">
        <Text bold color="yellow">TOP OPPORTUNITIES</Text>
        <OpportunityTable rows={p.opportunities.slice(0, 4)} markets={p.markets} isScanning={p.isScanning} selectedIndex={-1} compact />
      </Box>
      <SidebarPositions positions={p.positions.slice(0, 3)} />
    </Box>
  );
};

export const OverviewView = (p: OverviewViewProps): React.JSX.Element => {
  useLiveTick();
  const brief = buildTraderBrief(p.focusSymbol, p.pipelineSnapshots ?? {}, p.opportunities);

  return (
    <Box flexDirection="column" gap={0} paddingX={1}>
      <TraderBriefPanel brief={brief} />
      <Text color="gray">{rule()}</Text>
      <Box flexDirection="row" gap={1}>
        <Box flexDirection="column" flexGrow={1} minWidth={40}>
          <AgentConsoleFeed
            entries={p.transcript ?? []}
            scrollOffset={p.selectedIndex}
            autoScroll={p.autoEnabled ?? true}
            limit={8}
          />
        </Box>
        <OverviewSidebar
          positions={p.positions}
          opportunities={p.opportunities}
          markets={p.markets}
          isScanning={p.isScanning}
          streamLive={p.streamLive}
          port={p.port}
        />
      </Box>
      <Text color="gray">{rule()}</Text>
      <MarketWatchPanel focusSymbol={p.focusSymbol} />
    </Box>
  );
};
