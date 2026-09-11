import React from 'react';
import { Box, Text } from 'ink';
import type { CircuitState } from '../../domain/risk/risk-config.js';

export interface ConsoleHeaderProps {
  readonly venue: string;
  readonly agentState: string;
  readonly marketOk: boolean;
  readonly executionOk: boolean;
  readonly circuit: CircuitState;
  readonly killSwitchHalted: boolean;
  readonly cycle: number;
  readonly time: string;
  readonly equity: number;
  readonly dailyPnl: number;
}

const circuitBadge = (c: CircuitState, halted: boolean): { label: string; color: string } => {
  if (halted) return { label: 'HALTED', color: 'red' };
  switch (c) {
    case 'NORMAL': return { label: 'NORMAL', color: 'green' };
    case 'CAUTION': return { label: 'CAUTION', color: 'yellow' };
    case 'REDUCED': return { label: 'REDUCED', color: 'magenta' };
    case 'EMERGENCY': return { label: 'EMERGENCY', color: 'red' };
    default: return { label: 'UNKNOWN', color: 'gray' };
  }
};

export const ConsoleHeader = (p: ConsoleHeaderProps): React.JSX.Element => {
  const cBadge = circuitBadge(p.circuit, p.killSwitchHalted);
  const pnlSign = p.dailyPnl >= 0 ? '+' : '';
  const pnlColor = p.dailyPnl >= 0 ? 'green' : 'red';
  const modeColor = p.venue.toLowerCase() === 'live' ? 'magenta' : 'yellow';

  return (
    <Box flexDirection="column" borderStyle="single" borderColor="cyan" paddingX={1}>
      <Box justifyContent="space-between">
        <Box gap={1}>
          <Text bold color="cyan">CRYPTO-AGENT</Text>
          <Text color="gray">│</Text>
          <Text color={modeColor}>● {p.venue.toUpperCase()}</Text>
          <Text color="gray">│</Text>
          <Text color="white">agent:<Text bold color="green">{p.agentState}</Text></Text>
          <Text color="gray">│</Text>
          <Text color="white">market:<Text color={p.marketOk ? 'green' : 'red'}>{p.marketOk ? 'OK' : 'STALE'}</Text></Text>
          <Text color="gray">│</Text>
          <Text color="white">exec:<Text color={p.executionOk ? 'green' : 'red'}>{p.executionOk ? 'OK' : 'ERR'}</Text></Text>
          <Text color="gray">│</Text>
          <Text color="white">risk:<Text color={cBadge.color}>{cBadge.label}</Text></Text>
        </Box>
        <Box gap={1}>
          <Text color="white">Eq: <Text bold>${p.equity.toFixed(2)}</Text></Text>
          <Text color="gray">│</Text>
          <Text color="white">PnL: <Text color={pnlColor}>{pnlSign}${p.dailyPnl.toFixed(2)}</Text></Text>
          <Text color="gray">│</Text>
          <Text color="gray">#{p.cycle}</Text>
          <Text color="gray">│</Text>
          <Text color="gray">{p.time}</Text>
        </Box>
      </Box>
    </Box>
  );
};
