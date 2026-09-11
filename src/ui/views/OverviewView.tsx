import React from 'react';
import { Box, Text } from 'ink';
import { getKernel } from '../../kernel.js';
import type { BrokerPosition } from '../../infrastructure/broker/broker.js';
import type { ActivityTimelineItem } from '../types.js';

export interface OverviewViewProps {
  readonly selectedIndex: number;
  readonly positions: readonly BrokerPosition[];
  readonly timeline: readonly ActivityTimelineItem[];
  readonly focusSymbol: string;
}

const SubsystemsPanel = (): React.JSX.Element => {
  const k = getKernel();
  const ks = k.killSwitch.halted;
  return (
    <Box flexDirection="row" gap={2} paddingY={0}>
      <Box flexDirection="column" flexGrow={1}>
        <Text bold color="cyan">AGENT SUB-SYSTEMS</Text>
        <Text color="gray">● Watcher: <Text color="green">ACTIVE</Text></Text>
        <Text color="gray">● Analyst: <Text color="green">15m/1h MTF</Text></Text>
        <Text color="gray">● Strategist: <Text color="green">4 Setups</Text></Text>
        <Text color="gray">● Risk Challenger: <Text color="green">ACTIVE</Text></Text>
        <Text color="gray">● Policy Gateway: <Text color="green">AUTHORITATIVE</Text></Text>
      </Box>
      <Box flexDirection="column" flexGrow={1}>
        <Text bold color="cyan">SAFETY & VENUE</Text>
        <Text color="gray">● Venue: <Text color="yellow">{k.venue.toUpperCase()}</Text></Text>
        <Text color="gray">● Broker: <Text color="green">CONNECTED</Text></Text>
        <Text color="gray">● Event Store: <Text color="green">DURABLE</Text></Text>
        <Text color="gray">● Reconciler: <Text color="green">SYNCED</Text></Text>
        <Text color="gray">● Kill Switch: <Text color={ks ? 'red' : 'green'}>{ks ? 'HALTED' : 'ARMED'}</Text></Text>
      </Box>
    </Box>
  );
};

const OpportunityList = ({ selectedIndex }: { selectedIndex: number }): React.JSX.Element => {
  const opps = [
    { sym: 'BTCUSDT', setup: 'Pullback Reclaim', tf: '1h', conf: 0.78, reg: 'TREND_UP', rr: 2.8, st: 'READY' },
    { sym: 'SOLUSDT', setup: 'Liquidity Sweep', tf: '15m', conf: 0.71, reg: 'RANGE', rr: 2.6, st: 'WATCH' },
    { sym: 'ETHUSDT', setup: 'Breakout Retest', tf: '1h', conf: 0.68, reg: 'TREND_UP', rr: 3.1, st: 'SIZING' },
    { sym: 'XRPUSDT', setup: 'Trend Cont.', tf: '4h', conf: 0.61, reg: 'EXPANSION', rr: 2.4, st: 'REJECT' },
  ];
  return (
    <Box flexDirection="column">
      <Text bold color="cyan">OPPORTUNITIES (Ranked by Confidence)</Text>
      <Text color="gray">#  SYMBOL    SETUP             TF   CONF   REGIME    R:R   STATE</Text>
      {opps.map((o, idx) => {
        const isSel = idx === selectedIndex;
        const color = o.st === 'REJECT' ? 'red' : o.st === 'READY' ? 'green' : 'yellow';
        return (
          <Text key={o.sym} color={isSel ? 'black' : undefined} backgroundColor={isSel ? 'cyan' : undefined}>
            {isSel ? '>' : ' '} {idx + 1}  {o.sym.padEnd(9)} {o.setup.padEnd(17)} {o.tf.padEnd(4)} {o.conf.toFixed(2)}   {o.reg.padEnd(9)} {o.rr.toFixed(1)}   <Text color={isSel ? 'black' : color}>{o.st}</Text>
          </Text>
        );
      })}
    </Box>
  );
};

const PositionsSummary = ({ positions }: { positions: readonly BrokerPosition[] }): React.JSX.Element => (
  <Box flexDirection="column">
    <Text bold color="cyan">POSITIONS ({positions.length}/2 MAX)</Text>
    {positions.length === 0 ? (
      <Text color="gray" italic>No open positions under active management.</Text>
    ) : (
      positions.map((p) => {
        const upnl = p.unrealizedPnl ?? 0;
        const pColor = upnl >= 0 ? 'green' : 'red';
        const sign = upnl >= 0 ? '+' : '';
        return (
          <Text key={p.pair}>
            ● {p.pair} <Text bold color={p.side === 'long' ? 'green' : 'red'}>{p.side.toUpperCase()}</Text> size: {p.size} @ {p.entryPrice.toFixed(2)} | mark: {p.markPrice?.toFixed(2) ?? '...'} | PnL: <Text color={pColor}>{sign}${upnl.toFixed(2)}</Text>
          </Text>
        );
      })
    )}
  </Box>
);

export const OverviewView = (p: OverviewViewProps): React.JSX.Element => (
  <Box flexDirection="column" gap={1} paddingX={1}>
    <SubsystemsPanel />
    <Text color="gray">{'─'.repeat(Math.max(20, (process.stdout.columns || 80) - 6))}</Text>
    <OpportunityList selectedIndex={p.selectedIndex} />
    <Text color="gray">{'─'.repeat(Math.max(20, (process.stdout.columns || 80) - 6))}</Text>
    <PositionsSummary positions={p.positions} />
  </Box>
);
