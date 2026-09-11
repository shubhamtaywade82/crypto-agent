import React, { useEffect, useState } from 'react';
import { Box, Text } from 'ink';
import { buildStrategyRows, type StrategyRow } from '../strategy-rows.js';

export interface StrategiesViewProps {
  readonly selectedIndex: number;
}

const statusColor = (s: StrategyRow['status']): string => {
  if (s === 'ACTIVE') return 'green';
  if (s === 'RETIRED') return 'red';
  if (s === 'DETECTOR') return 'gray';
  return 'yellow';
};

const StrategyTable = (p: { readonly rows: readonly StrategyRow[]; readonly safeIdx: number }): React.JSX.Element => (
  <Box flexDirection="column">
    <Text color="gray">   STRATEGY ID          STATUS     VER   CELLS  TRADES  EXPECTANCY  PF</Text>
    {p.rows.map((s, idx) => {
      const isSel = idx === p.safeIdx;
      return (
        <Text key={s.id} color={isSel ? 'black' : undefined} backgroundColor={isSel ? 'cyan' : undefined}>
          {isSel ? ' >' : '  '} {s.id.padEnd(20)} <Text color={isSel ? 'black' : statusColor(s.status)}>{s.status.padEnd(10)}</Text> {s.version.padEnd(5)} {String(s.cells).padEnd(6)} {String(s.trades).padEnd(7)} {s.expectancy.padEnd(11)} {s.pf > 0 ? s.pf.toFixed(2) : '—'}
        </Text>
      );
    })}
  </Box>
);

const useStrategyPoll = (): readonly StrategyRow[] => {
  const [, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 3000);
    return (): void => clearInterval(t);
  }, []);
  return buildStrategyRows();
};

export const StrategiesView = ({ selectedIndex }: StrategiesViewProps): React.JSX.Element => {
  const rows = useStrategyPoll();
  const safeIdx = Math.min(selectedIndex, Math.max(0, rows.length - 1));
  const selected = rows[safeIdx];
  const rule = '─'.repeat(Math.max(20, (process.stdout.columns || 80) - 6));

  return (
    <Box flexDirection="column" gap={1} paddingX={1}>
      <Text bold color="cyan">STRATEGY CELL RESEARCH &amp; PROMOTION CONSOLE</Text>
      {rows.length === 0 ? (
        <Text color="gray" italic>No strategies registered — ledger empty and registry not hydrated.</Text>
      ) : (
        <>
          <StrategyTable rows={rows} safeIdx={safeIdx} />
          {selected ? (
            <>
              <Text color="gray">{rule}</Text>
              <Text bold color="yellow">SELECTED: {selected.id} ({selected.version})</Text>
              <Text color="gray">├─ Stats: {selected.detail}</Text>
              <Text color="gray">└─ Cells: {selected.approvedCells.length ? selected.approvedCells.join(', ') : 'none yet'}</Text>
            </>
          ) : null}
        </>
      )}
    </Box>
  );
};
