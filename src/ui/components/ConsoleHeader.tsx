import React, { useEffect, useState } from 'react';
import { Box, Text } from 'ink';
import { Divider } from '../../components/ui/divider/index.js';
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

const formatDate = (): string =>
  new Date().toLocaleDateString('en-IN', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' });

const formatUptime = (bootAt: number): string => {
  const ms = Date.now() - bootAt;
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  return `${h}h ${m}m`;
};

const useClock = (): { readonly time: string; readonly date: string; readonly uptime: string } => {
  const [bootAt] = useState(() => Date.now());
  const [time, setTime] = useState(formatClock);
  const [date] = useState(formatDate);
  const [uptime, setUptime] = useState(() => formatUptime(bootAt));
  useEffect(() => {
    const t = setInterval(() => {
      setTime(formatClock());
      setUptime(formatUptime(bootAt));
    }, 1000);
    return (): void => clearInterval(t);
  }, [bootAt]);
  return { time, date, uptime };
};

const circuitLabel = (c: CircuitState, halted: boolean): string => {
  if (halted) return 'HALTED';
  return c;
};


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

const HeaderTitleRow = ({ date, uptime, liveLabel, venueColor }: {
  readonly date: string; readonly uptime: string; readonly liveLabel: string; readonly venueColor: string;
}): React.JSX.Element => (
  <Text wrap="truncate">
    <Text bold color="cyan">CRYPTO-AGENT v1.0.0</Text>
    <Text color="gray"> │ </Text><Text color="gray">{date}</Text>
    <Text color="gray"> │ </Text><Text color={venueColor}>● {liveLabel}</Text>
    <Text color="gray"> │ </Text><Text color="gray">up {uptime}</Text>
  </Text>
);

const HeaderStatusRow = (p: ConsoleHeaderProps & { readonly risk: string; readonly pnlSign: string; readonly pnlColor: string; readonly time: string; readonly venueColor: string }): React.JSX.Element => (
  <Text wrap="truncate">
    <Text color={p.venueColor}>{p.venue.toUpperCase()}</Text>
    <Text color="gray"> │ agent:</Text>
    <Text bold color={p.agentState === 'BUSY' ? 'yellow' : 'green'}>{p.agentState}</Text>
    <Text color="gray"> │ MD:</Text>
    <Text color={p.marketOk ? 'green' : 'red'}>{p.marketOk ? 'OK' : 'STALE'}</Text>
    <Text color="gray"> │ exec:</Text>
    <Text color={p.executionOk ? 'green' : 'red'}>{p.executionOk ? 'OK' : 'ERR'}</Text>
    <Text color="gray"> │ risk:</Text>
    <Text color={p.risk === 'NORMAL' ? 'green' : 'yellow'}>{p.risk}</Text>
    <HeaderMetrics p={p} pnlSign={p.pnlSign} pnlColor={p.pnlColor} time={p.time} />
  </Text>
);

export const ConsoleHeader = (p: ConsoleHeaderProps): React.JSX.Element => {
  const { time, date, uptime } = useClock();
  const risk = circuitLabel(p.circuit, p.killSwitchHalted);
  const venueColor = p.venue.toLowerCase() === 'live' ? 'magenta' : 'yellow';
  const liveLabel = p.venue.toLowerCase() === 'live' ? 'LIVE' : 'PAPER';
  const pnlSign = p.dailyPnl >= 0 ? '+' : '';
  const pnlColor = p.dailyPnl >= 0 ? 'green' : 'red';

  return (
    <Box flexDirection="column" marginBottom={0}>
      <HeaderTitleRow date={date} uptime={uptime} liveLabel={liveLabel} venueColor={venueColor} />
      <Text wrap="truncate" color="gray">Autonomous AI + Deterministic Crypto Futures Trading</Text>
      <HeaderStatusRow {...p} risk={risk} pnlSign={pnlSign} pnlColor={pnlColor} time={time} venueColor={venueColor} />
      <Divider style="single" />
    </Box>
  );
};
