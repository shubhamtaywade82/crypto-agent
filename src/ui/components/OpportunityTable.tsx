import React from 'react';
import { Box, Text } from 'ink';
import type { ScanOpportunity } from '../scan-opportunities.js';

const stateColor = (state: string): string => {
  if (state === 'REJECTED' || state === 'HALTED') return 'red';
  if (state === 'READY' || state === 'EXECUTED') return 'green';
  return 'yellow';
};

export const OpportunityTable = (p: {
  readonly rows: readonly ScanOpportunity[];
  readonly selectedIndex: number;
  readonly compact?: boolean;
}): React.JSX.Element => {
  if (p.rows.length === 0) {
    return <Text color="gray" italic>No scan results yet — run /scan or wait for auto-scan</Text>;
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
