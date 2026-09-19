import React, { useEffect, useMemo } from 'react';
import { Box, Text } from 'ink';
import { Divider } from '../../components/ui/divider/index.js';
import { StatusIndicator } from '../../components/ui/status-indicator/index.js';
import { Badge } from '../../components/ui/badge/index.js';
import { ProgressBar } from '../../components/ui/progress-bar/index.js';
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
  readonly height?: number;
  readonly setSelectedIndex?: React.Dispatch<React.SetStateAction<number>>;
}

const TOTAL_VIEW_HEIGHT = 38;
const SCROLL_STEP = 3;

/** Row count for the adaptive list panels (depth ladder, tape, console feed). Shrinks
 * on short terminals so total content never exceeds the workspace box and gets clipped. */
const adaptiveListRows = (height: number): number => {
  if (height >= 26) return 5;
  if (height >= 22) return 4;
  return 3;
};

export const computeScrollY = (
  selectedIndex: number,
  viewportH: number
): { scrollY: number; maxScroll: number; maxIdx: number } => {
  const maxScroll = Math.max(0, TOTAL_VIEW_HEIGHT - viewportH);
  const maxIdx = Math.ceil(maxScroll / SCROLL_STEP);
  const safeIdx = Math.min(Math.max(0, selectedIndex), maxIdx);
  const scrollY = Math.min(safeIdx * SCROLL_STEP, maxScroll);
  return { scrollY, maxScroll, maxIdx };
};

const DepthAndTape = ({ symbol, rows }: { readonly symbol: string; readonly rows: number }): React.JSX.Element => {
  const book = getKernel().marketStore.peekBook(symbol);
  return (
    <Box flexDirection="row" marginTop={0} flexShrink={0}>
      <Box width="50%" flexDirection="column" paddingRight={1} flexShrink={0}>
        <Text bold color="yellow">Depth ({symbol})</Text>
        {book?.bids.length ? (
          <DepthLadder bids={book.bids} asks={book.asks} last={book.last} mark={book.mark} micro={book.microstructure} symbol={symbol} levels={rows} />
        ) : <Text color="gray">depth streaming…</Text>}
      </Box>
      <Box
        width="50%"
        flexDirection="column"
        borderStyle="single"
        borderLeft={true}
        borderRight={false}
        borderTop={false}
        borderBottom={false}
        borderColor="gray"
        paddingLeft={1}
        flexShrink={0}
      >
        <Text bold color="yellow">Tape ({symbol})</Text>
        <Text color="gray">WS aggTrade + REST refresh</Text>
        <LiveTape symbol={symbol} limit={rows} />
      </Box>
    </Box>
  );
};

const MarketWatchPanel = ({ focusSymbol, scrollHint, rows }: {
  readonly focusSymbol: string;
  readonly scrollHint?: string;
  readonly rows: number;
}): React.JSX.Element => {
  const symbols = useMemo(() => kernelWatchSymbols(), []);
  useEffect(() => {
    void ensureSymbolTracked(focusSymbol).catch(() => undefined);
    for (const sym of symbols) void ensureSymbolTracked(sym).catch(() => undefined);
  }, [focusSymbol, symbols]);
  return (
    <Box flexDirection="column" gap={0} flexShrink={0}>
      <Box justifyContent="space-between" marginBottom={0}>
        <Text bold color="cyan">MARKET WATCH — ALL SYMBOLS · ORDER BOOK & TAPE</Text>
        <Text color="gray">
          /focus <Text bold color="yellow">{focusSymbol}</Text>
          {scrollHint ? <Text color="yellow"> │ {scrollHint}</Text> : null}
        </Text>
      </Box>
      <LiveLtpTable hideHeader />
      <DepthAndTape symbol={focusSymbol} rows={rows} />
    </Box>
  );
};

const SidebarSystemStatus = ({ streamLive, halted, circuit }: {
  readonly streamLive: boolean;
  readonly halted: boolean;
  readonly circuit: string;
}): React.JSX.Element => (
  <Box flexDirection="column" gap={0} flexShrink={0}>
    <Text bold color="yellow">SYSTEM STATUS</Text>
    <StatusIndicator status="online" label="Agent Runtime" />
    <StatusIndicator status={streamLive ? 'online' : 'error'} label="Binance MD WS" />
    <StatusIndicator status={!halted ? 'online' : 'error'} label="Execution" />
    <Box gap={1} marginTop={0}>
      <Text color="gray">Circuit:</Text>
      <Badge variant={halted ? 'error' : circuit === 'NORMAL' ? 'success' : 'warning'}>{circuit}</Badge>
    </Box>
  </Box>
);

const SidebarPositions = ({ positions }: { readonly positions: readonly BrokerPosition[] }): React.JSX.Element => (
  <Box flexDirection="column" flexShrink={0}>
    <Text bold color="yellow">RECENT POSITIONS</Text>
    {positions.length === 0 ? <Text color="gray" italic wrap="truncate">None open</Text> : positions.map((pos) => {
      const upnl = pos.unrealizedPnl ?? 0;
      const sign = upnl >= 0 ? '+' : '';
      return (
        <Text key={pos.pair} wrap="truncate">
          {pos.pair.slice(0, 9).padEnd(9)} <Text color={pos.side === 'long' ? 'green' : 'red'}>{pos.side.toUpperCase()}</Text>
          {' '}<Text color={upnl >= 0 ? 'green' : 'red'}>{sign}${upnl.toFixed(2)}</Text>
        </Text>
      );
    })}
  </Box>
);

const SidebarPortfolio = ({ snap, limits }: {
  readonly snap: ReturnType<typeof getKernel>['portfolio']['peek'] extends () => infer R ? R : never;
  readonly limits: ReturnType<typeof getKernel>['limits'];
}): React.JSX.Element => (
  <Box flexDirection="column" flexShrink={0}>
    <Text bold color="yellow">PORTFOLIO</Text>
    <Text color="gray">Eq <Text bold color="white">${snap.equity.toFixed(2)}</Text> │ Today <Text color={snap.dailyRealizedPnl >= 0 ? 'green' : 'red'}>{snap.dailyRealizedPnl >= 0 ? '+' : ''}${snap.dailyRealizedPnl.toFixed(2)}</Text></Text>
    <Box gap={1}>
      <Text color="gray">Pos <Text color="white">{snap.openPositions}/{limits.maxConcurrentPositions}</Text></Text>
      <ProgressBar
        value={limits.maxConcurrentPositions === 0 ? 0 : (snap.openPositions / limits.maxConcurrentPositions) * 100}
        width={8}
        showPercent={false}
      />
      <Text color="gray">Lev <Text color="white">{limits.maxLeverage}x</Text></Text>
    </Box>
  </Box>
);

const TopOpportunities = ({ opps, isScanning }: {
  readonly opps: readonly ScanOpportunity[];
  readonly isScanning?: boolean;
}): React.JSX.Element => (
  <Box flexDirection="column" marginTop={0} flexShrink={0}>
    <Text bold color="yellow">TOP OPPORTUNITIES</Text>
    {opps.length === 0 ? (
      <Text color="gray" italic wrap="truncate">None active</Text>
    ) : (
      <OpportunityTable rows={opps.slice(0, 3)} isScanning={isScanning} selectedIndex={-1} compact />
    )}
  </Box>
);

const OverviewSidebar = (p: {
  readonly positions: readonly BrokerPosition[];
  readonly opportunities: readonly ScanOpportunity[];
  readonly isScanning?: boolean;
  readonly streamLive?: boolean;
  readonly port?: ReturnType<typeof usePortfolio>;
}): React.JSX.Element => {
  const k = getKernel();
  const snap = p.port ?? k.portfolio.peek();
  const circuit = deriveCircuitState(snap.dailyLossPercent, snap.drawdownPercent, snap.lossStreak, k.limits);

  return (
    <Box flexDirection="column" width={42} flexShrink={0} gap={0} borderStyle="single" borderLeft borderRight={false} borderTop={false} borderBottom={false} borderColor="gray" paddingLeft={1}>
      <SidebarSystemStatus streamLive={p.streamLive ?? false} halted={k.killSwitch.halted} circuit={circuit} />
      <SidebarPortfolio snap={snap} limits={k.limits} />
      <TopOpportunities opps={p.opportunities} isScanning={p.isScanning} />
      <SidebarPositions positions={p.positions.slice(0, 3)} />
    </Box>
  );
};

const OverviewMainContent = ({
  p,
  brief,
  scrollHint,
  rows,
}: {
  readonly p: OverviewViewProps;
  readonly brief: ReturnType<typeof buildTraderBrief>;
  readonly scrollHint?: string;
  readonly rows: number;
}): React.JSX.Element => (
  <>
    <TraderBriefPanel brief={brief} />
    <Divider style="single" />
    <Box flexDirection="row" gap={1} flexShrink={0}>
      <Box flexDirection="column" flexGrow={1} minWidth={40} flexShrink={0}>
        <AgentConsoleFeed entries={p.transcript ?? []} scrollOffset={0} autoScroll={p.autoEnabled ?? true} limit={rows} />
      </Box>
      <OverviewSidebar positions={p.positions} opportunities={p.opportunities} isScanning={p.isScanning} streamLive={p.streamLive} port={p.port} />
    </Box>
    <Divider style="single" />
    <MarketWatchPanel focusSymbol={p.focusSymbol} scrollHint={scrollHint} rows={rows} />
  </>
);

export const OverviewView = (p: OverviewViewProps): React.JSX.Element => {
  useLiveTick();
  const brief = buildTraderBrief(p.focusSymbol, p.pipelineSnapshots ?? {}, p.opportunities);
  const height = p.height ?? 24;
  const { scrollY, maxScroll, maxIdx } = computeScrollY(p.selectedIndex, height);
  const rows = adaptiveListRows(height);

  useEffect(() => {
    if (p.selectedIndex > maxIdx && maxIdx >= 0) p.setSelectedIndex?.(maxIdx);
  }, [p.selectedIndex, maxIdx, p.setSelectedIndex]);

  const hint = maxScroll > 0 ? (scrollY > 0 ? '▲ PgUp/↑' : '▼ PgDn/↓ for Depth & Tape') : undefined;

  return (
    <Box flexDirection="column" gap={0} flexShrink={0} marginTop={-scrollY}>
      <OverviewMainContent p={p} brief={brief} scrollHint={hint} rows={rows} />
    </Box>
  );
};
