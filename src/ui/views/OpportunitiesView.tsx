import React from 'react';
import { Box, Text } from 'ink';
import type { MonitoredMarket, ScanOpportunity } from '../scan-opportunities.js';
import { MarketDetail, OpportunityDetail, OpportunityTable } from '../components/OpportunityTable.js';

export interface OpportunitiesViewProps {
  readonly selectedIndex: number;
  readonly opportunities: readonly ScanOpportunity[];
  readonly markets?: readonly MonitoredMarket[];
  readonly isScanning?: boolean;
}

export const OpportunitiesView = (p: OpportunitiesViewProps): React.JSX.Element => {
  const hasOpps = p.opportunities.length > 0;
  const oppIdx = Math.min(p.selectedIndex, Math.max(0, p.opportunities.length - 1));
  const selOpp = hasOpps ? p.opportunities[oppIdx] : undefined;
  const mktList = p.markets ?? [];
  const mktIdx = Math.min(p.selectedIndex, Math.max(0, mktList.length - 1));
  const selMkt = !hasOpps ? mktList[mktIdx] : undefined;
  const title = hasOpps
    ? 'RANKED MARKET OPPORTUNITIES (SORT: CONFIDENCE DESC)'
    : 'MONITORED WATCHLIST (NO ACTIVE SETUPS >= 2.5 R:R)';

  return (
    <Box flexDirection="column" gap={1} paddingX={1}>
      <Text bold color="cyan">{title}</Text>
      <OpportunityTable
        rows={p.opportunities} markets={p.markets}
        isScanning={p.isScanning} selectedIndex={p.selectedIndex}
      />
      {selOpp && <><Text color="gray">{'─'.repeat(Math.max(20, (process.stdout.columns || 80) - 6))}</Text><OpportunityDetail row={selOpp} /></>}
      {selMkt && <><Text color="gray">{'─'.repeat(Math.max(20, (process.stdout.columns || 80) - 6))}</Text><MarketDetail market={selMkt} /></>}
    </Box>
  );
};
