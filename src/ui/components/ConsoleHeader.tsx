import React, { useEffect, useState } from 'react';
import { Box, Text } from 'ink';
import { Badge, type BadgeVariant } from '../../components/ui/badge/index.js';
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

const circuitVariant = (risk: string): BadgeVariant =>
  risk === 'HALTED' || risk === 'EMERGENCY' ? 'error' : 'warning';

const HeaderMetrics = ({ p, pnlSign, pnlColor, time }: {
  readonly p: ConsoleHeaderProps; readonly pnlSign: string; readonly pnlColor: string; readonly time: string;
}): React.JSX.Element => (
  <Box>
    <Text color="gray"> │ </Text>
    <Text>Eq </Text><Text bold>${p.equity.toFixed(2)}</Text>
    <Text color="gray"> │ </Text>
    <Text>PnL </Text><Text color={pnlColor}>{pnlSign}${p.dailyPnl.toFixed(2)}</Text>
    <Text color="gray"> │ </Text>
    <Text color="gray">#{p.cycle} {time}</Text>
  </Box>
);

const HeaderTitleRow = ({ date, uptime, liveLabel }: {
  readonly date: string; readonly uptime: string; readonly liveLabel: string;
}): React.JSX.Element => (
  <Box>
    <Text bold color="cyan">CRYPTO-AGENT v1.0.0</Text>
    <Text color="gray"> │ </Text><Text color="gray">{date}</Text>
    <Text color="gray"> │ </Text>
    <Badge variant={liveLabel === 'LIVE' ? 'error' : 'info'}>{liveLabel}</Badge>
    <Text color="gray"> │ </Text><Text color="gray">up {uptime}</Text>
  </Box>
);

const HeaderStatusRow = (p: ConsoleHeaderProps & { readonly risk: string; readonly pnlSign: string; readonly pnlColor: string; readonly time: string }): React.JSX.Element => (
  <Box alignItems="center">
    <Badge variant={p.venue.toLowerCase() === 'live' ? 'error' : 'info'}>{p.venue.toUpperCase()}</Badge>
    <Text color="gray"> agent:</Text>
    <Text bold color={p.agentState === 'BUSY' ? 'yellow' : 'green'}>{p.agentState}</Text>
    <Text color="gray"> MD:</Text>
    <Badge variant={p.marketOk ? 'success' : 'error'}>{p.marketOk ? 'OK' : 'STALE'}</Badge>
    <Text color="gray"> exec:</Text>
    <Badge variant={p.executionOk ? 'success' : 'error'}>{p.executionOk ? 'OK' : 'ERR'}</Badge>
    <Text color="gray"> risk:</Text>
    <Badge variant={circuitVariant(p.risk)}>{p.risk}</Badge>
    <HeaderMetrics p={p} pnlSign={p.pnlSign} pnlColor={p.pnlColor} time={p.time} />
  </Box>
);

export const ConsoleHeader = (p: ConsoleHeaderProps): React.JSX.Element => {
  const { time, date, uptime } = useClock();
  const risk = circuitLabel(p.circuit, p.killSwitchHalted);
  const liveLabel = p.venue.toLowerCase() === 'live' ? 'LIVE' : 'PAPER';
  const pnlSign = p.dailyPnl >= 0 ? '+' : '';
  const pnlColor = p.dailyPnl >= 0 ? 'green' : 'red';

  return (
    <Box flexDirection="column" marginBottom={0}>
      <HeaderTitleRow date={date} uptime={uptime} liveLabel={liveLabel} />
      <Text wrap="truncate" color="gray">Autonomous AI + Deterministic Crypto Futures Trading</Text>
      <HeaderStatusRow {...p} risk={risk} pnlSign={pnlSign} pnlColor={pnlColor} time={time} />
      <Divider style="single" />
    </Box>
  );
};
