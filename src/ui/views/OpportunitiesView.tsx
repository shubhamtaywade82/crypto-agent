import React from 'react';
import { Box, Text } from 'ink';

export interface OpportunitiesViewProps {
  readonly selectedIndex: number;
}

interface CandidateRow {
  readonly symbol: string;
  readonly setup: string;
  readonly dir: 'LONG' | 'SHORT';
  readonly tf: string;
  readonly conf: number;
  readonly regime: string;
  readonly rr: number;
  readonly state: string;
  readonly thesis: string;
  readonly mtf: string;
}

const CANDIDATES: readonly CandidateRow[] = [
  { symbol: 'BTCUSDT', setup: 'Pullback Reclaim', dir: 'LONG', tf: '1h', conf: 0.78, regime: 'TREND_UP', rr: 2.8, state: 'READY', thesis: 'HTF continuation after 15m liquidity reclaim', mtf: '4H↑ 1H↑ 15m↑ 5m→' },
  { symbol: 'SOLUSDT', setup: 'Liquidity Sweep', dir: 'SHORT', tf: '15m', conf: 0.71, regime: 'RANGE', rr: 2.6, state: 'WATCH', thesis: 'Sweep of local high at 204.50 with bearish divergence', mtf: '4H→ 1H↓ 15m↓ 5m↓' },
  { symbol: 'ETHUSDT', setup: 'Breakout Retest', dir: 'LONG', tf: '1h', conf: 0.68, regime: 'TREND_UP', rr: 3.1, state: 'SIZING', thesis: 'Clean retest of 4,280 breakout level with volume surge', mtf: '4H↑ 1H↑ 15m→ 5m↑' },
  { symbol: 'BNBUSDT', setup: 'Trend Continuation', dir: 'LONG', tf: '4h', conf: 0.63, regime: 'TREND_UP', rr: 2.5, state: 'WATCH', thesis: 'Pullback to 20 EMA with bullish order block hold', mtf: '4H↑ 1H→ 15m→ 5m→' },
  { symbol: 'XRPUSDT', setup: 'Breakout Retest', dir: 'LONG', tf: '1h', conf: 0.58, regime: 'EXPANSION', rr: 2.3, state: 'REJECTED', thesis: 'RR below 2.5 minimum threshold (rejected by gate)', mtf: '4H→ 1H↑ 15m→ 5m→' },
];

export const OpportunitiesView = ({ selectedIndex }: OpportunitiesViewProps): React.JSX.Element => {
  const safeIdx = Math.min(selectedIndex, CANDIDATES.length - 1);
  const selected = CANDIDATES[safeIdx] ?? CANDIDATES[0]!;

  return (
    <Box flexDirection="column" gap={1} paddingX={1}>
      <Text bold color="cyan">RANKED MARKET OPPORTUNITIES (SORT: CONFIDENCE DESC)</Text>
      <Box flexDirection="column">
        <Text color="gray">   #  SYMBOL    DIR    SETUP             TF   CONF   REGIME     R:R   STATE</Text>
        {CANDIDATES.map((c, idx) => {
          const isSel = idx === safeIdx;
          const dirColor = c.dir === 'LONG' ? 'green' : 'red';
          const stColor = c.state === 'READY' ? 'green' : c.state === 'REJECTED' ? 'red' : 'yellow';
          return (
            <Text key={c.symbol} color={isSel ? 'black' : undefined} backgroundColor={isSel ? 'cyan' : undefined}>
              {isSel ? ' >' : '  '} {idx + 1}  {c.symbol.padEnd(9)} <Text color={isSel ? 'black' : dirColor}>{c.dir.padEnd(6)}</Text> {c.setup.padEnd(17)} {c.tf.padEnd(4)} {c.conf.toFixed(2)}   {c.regime.padEnd(10)} {c.rr.toFixed(1)}   <Text color={isSel ? 'black' : stColor}>{c.state}</Text>
            </Text>
          );
        })}
      </Box>

      <Text color="gray">{'─'.repeat(Math.max(20, (process.stdout.columns || 80) - 6))}</Text>

      <Box flexDirection="column">
        <Text bold color="yellow">SELECTED CANDIDATE: {selected.symbol} ({selected.dir})</Text>
        <Text color="gray">├─ Setup:        <Text color="white">{selected.setup} ({selected.tf})</Text></Text>
        <Text color="gray">├─ Evidence MTF: <Text color="white">{selected.mtf}</Text></Text>
        <Text color="gray">├─ Thesis:       <Text color="white">"{selected.thesis}"</Text></Text>
        <Text color="gray">└─ Decision:     <Text color="white">Confidence: {selected.conf.toFixed(2)} │ R:R: {selected.rr.toFixed(1)} │ State: <Text bold color={selected.state === 'READY' ? 'green' : 'yellow'}>{selected.state}</Text></Text></Text>
      </Box>
    </Box>
  );
};
