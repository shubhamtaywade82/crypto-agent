import React from 'react';
import { Box, Text } from 'ink';

export interface StrategiesViewProps {
  readonly selectedIndex: number;
}

interface StrategyInfo {
  readonly id: string;
  readonly status: 'ACTIVE' | 'CANDIDATE' | 'RETIRED';
  readonly version: string;
  readonly cells: number;
  readonly trades: number;
  readonly expectancy: string;
  readonly pf: number;
  readonly isSample: string;
  readonly oosSample: string;
  readonly tStat: number;
}

const STRATEGIES: readonly StrategyInfo[] = [
  { id: 'pullback-reclaim', status: 'ACTIVE', version: 'v3.1', cells: 4, trades: 128, expectancy: '+0.31R', pf: 1.84, isSample: 'n=84 E=+0.34R', oosSample: 'n=44 E=+0.25R', tStat: 2.84 },
  { id: 'liquidity-sweep', status: 'ACTIVE', version: 'v2.4', cells: 3, trades: 94, expectancy: '+0.24R', pf: 1.62, isSample: 'n=62 E=+0.28R', oosSample: 'n=32 E=+0.19R', tStat: 2.31 },
  { id: 'breakout-retest', status: 'ACTIVE', version: 'v4.0', cells: 2, trades: 151, expectancy: '+0.19R', pf: 1.55, isSample: 'n=102 E=+0.21R', oosSample: 'n=49 E=+0.16R', tStat: 2.12 },
  { id: 'trend-continuation', status: 'CANDIDATE', version: 'v1.0', cells: 0, trades: 18, expectancy: '+0.12R', pf: 1.28, isSample: 'n=18 E=+0.12R', oosSample: 'pending', tStat: 1.45 },
  { id: 'mean-reversion-v2', status: 'RETIRED', version: 'v2.0', cells: 0, trades: 73, expectancy: '-0.08R', pf: 0.82, isSample: 'n=50 E=-0.04R', oosSample: 'n=23 E=-0.14R', tStat: -1.89 },
];

export const StrategiesView = ({ selectedIndex }: StrategiesViewProps): React.JSX.Element => {
  const safeIdx = Math.min(selectedIndex, STRATEGIES.length - 1);
  const selected = STRATEGIES[safeIdx] ?? STRATEGIES[0]!;

  return (
    <Box flexDirection="column" gap={1} paddingX={1}>
      <Text bold color="cyan">STRATEGY CELL RESEARCH &amp; PROMOTION CONSOLE</Text>

      <Box flexDirection="column">
        <Text color="gray">   STRATEGY ID          STATUS     VER   CELLS  TRADES  EXPECTANCY  PF</Text>
        {STRATEGIES.map((s, idx) => {
          const isSel = idx === safeIdx;
          const stColor = s.status === 'ACTIVE' ? 'green' : s.status === 'RETIRED' ? 'red' : 'yellow';
          return (
            <Text key={s.id} color={isSel ? 'black' : undefined} backgroundColor={isSel ? 'cyan' : undefined}>
              {isSel ? ' >' : '  '} {s.id.padEnd(20)} <Text color={isSel ? 'black' : stColor}>{s.status.padEnd(10)}</Text> {s.version.padEnd(5)} {String(s.cells).padEnd(6)} {String(s.trades).padEnd(7)} {s.expectancy.padEnd(11)} {s.pf.toFixed(2)}
            </Text>
          );
        })}
      </Box>

      <Text color="gray">{'─'.repeat(Math.max(20, (process.stdout.columns || 80) - 6))}</Text>

      <Box flexDirection="column">
        <Text bold color="yellow">SELECTED STRATEGY: {selected.id} ({selected.version})</Text>
        <Text color="gray">├─ Promotion:    In-Sample ({selected.isSample}) │ OOS ({selected.oosSample}) │ t-stat: {selected.tStat.toFixed(2)}</Text>
        <Text color="gray">├─ Approved:     TREND_UP × LONG <Text color="green">✓</Text> │ EXPANSION × LONG <Text color="green">✓</Text> │ RANGE × LONG <Text color="red">✗</Text> │ HIGH_VOL <Text color="red">✗</Text></Text>
        <Text color="gray">└─ Gate Filter:  Microstructure spread &lt;= 2.5 bps, order book imbalance &gt;= +15%</Text>
      </Box>
    </Box>
  );
};
