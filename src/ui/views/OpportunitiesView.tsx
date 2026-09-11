import React from 'react';
import { Box, Text } from 'ink';
import type { ScanOpportunity } from '../scan-opportunities.js';
import { OpportunityDetail, OpportunityTable } from '../components/OpportunityTable.js';

export interface OpportunitiesViewProps {
  readonly selectedIndex: number;
  readonly opportunities: readonly ScanOpportunity[];
}

export const OpportunitiesView = ({ selectedIndex, opportunities }: OpportunitiesViewProps): React.JSX.Element => {
  const safeIdx = Math.min(selectedIndex, Math.max(0, opportunities.length - 1));
  const selected = opportunities[safeIdx];

  return (
    <Box flexDirection="column" gap={1} paddingX={1}>
      <Text bold color="cyan">RANKED MARKET OPPORTUNITIES (SORT: CONFIDENCE DESC)</Text>
      <OpportunityTable rows={opportunities} selectedIndex={selectedIndex} />
      {selected && (
        <>
          <Text color="gray">{'─'.repeat(Math.max(20, (process.stdout.columns || 80) - 6))}</Text>
          <OpportunityDetail row={selected} />
        </>
      )}
    </Box>
  );
};
