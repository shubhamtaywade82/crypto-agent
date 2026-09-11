import React, { useEffect, useState } from 'react';
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
  readonly equity: number;
  readonly dailyPnl: number;
}

const formatClock = (): string =>
  new Date().toLocaleTimeString('en-IN', { hour12: false });

const useClock = (): string => {
  const [time, setTime] = useState(formatClock);
  useEffect(() => {
    const t = setInterval(() => setTime(formatClock()), 1000);
    return (): void => clearInterval(t);
  }, []);
  return time;
};

const circuitLabel = (c: CircuitState, halted: boolean): string => {
  if (halted) return 'HALTED';
  return c;
};

const rule = (): string => '─'.repeat(Math.max(20, (process.stdout.columns || 80) - 2));

const HeaderMetrics = ({ p, pnlSign, pnlColor, time }: {
  readonly p: ConsoleHeaderProps; readonly pnlSign: string; readonly pnlColor: string; readonly time: string;
}): React.JSX.Element => (
  <>
    <Text color="gray"> │ </Text>
    <Text>Eq </Text><Text bold>${p.equity.toFixed(2)}</Text>
    <Text color="gray"> │ </Text>
    <Text>PnL </Text><Text color={pnlColor}>{pnlSign}${p.dailyPnl.toFixed(2)}</Text>
    <Text color="gray"> │ </Text>
    <Text color="gray">#{p.cycle} {time}</Text>
  </>
);

export const ConsoleHeader = (p: ConsoleHeaderProps): React.JSX.Element => {
  const time = useClock();
  const risk = circuitLabel(p.circuit, p.killSwitchHalted);
  const pnlSign = p.dailyPnl >= 0 ? '+' : '';
  const pnlColor = p.dailyPnl >= 0 ? 'green' : 'red';
  const venueColor = p.venue.toLowerCase() === 'live' ? 'magenta' : 'yellow';

  return (
    <Box flexDirection="column" marginBottom={0}>
      <Text wrap="truncate">
        <Text bold color="cyan">CRYPTO-AGENT</Text>
        <Text color="gray"> │ </Text>
        <Text color={venueColor}>● {p.venue.toUpperCase()}</Text>
        <Text color="gray"> │ </Text>
        <Text>agent:</Text>
        <Text bold color={p.agentState === 'BUSY' ? 'yellow' : 'green'}>{p.agentState}</Text>
        <Text color="gray"> │ </Text>
        <Text>MD:</Text>
        <Text color={p.marketOk ? 'green' : 'red'}>{p.marketOk ? 'OK' : 'STALE'}</Text>
        <Text color="gray"> │ </Text>
        <Text>exec:</Text>
        <Text color={p.executionOk ? 'green' : 'red'}>{p.executionOk ? 'OK' : 'ERR'}</Text>
        <Text color="gray"> │ </Text>
        <Text>risk:</Text>
        <Text color={risk === 'NORMAL' ? 'green' : 'yellow'}>{risk}</Text>
        <HeaderMetrics p={p} pnlSign={pnlSign} pnlColor={pnlColor} time={time} />
      </Text>
      <Text color="gray">{rule()}</Text>
    </Box>
  );
};
