import React from 'react';
import { Box, Text } from 'ink';
import type { ActivityTimelineItem } from '../types.js';

export interface EventsViewProps {
  readonly timeline: readonly ActivityTimelineItem[];
  readonly selectedIndex: number;
}

const levelColor = (lvl: string): string => {
  switch (lvl) {
    case 'SUCCESS': return 'green';
    case 'WARN': return 'yellow';
    case 'ERROR': return 'red';
    default: return 'cyan';
  }
};

const actorColor = (act: string): string => {
  switch (act) {
    case 'ANALYST': return 'green';
    case 'STRATEGIST': return 'yellow';
    case 'RISK': return 'magenta';
    case 'POLICY': return 'blue';
    case 'EXECUTION':
    case 'FILL':
    case 'POSITION': return 'green';
    case 'USER': return 'white';
    default: return 'gray';
  }
};

export const EventsView = ({ timeline, selectedIndex }: EventsViewProps): React.JSX.Element => {
  const items = timeline.length > 0 ? timeline : [
    { id: '1', at: '11:58:02', actor: 'SYSTEM' as const, level: 'INFO' as const, summary: 'Market scan completed across 42 symbols' },
    { id: '2', at: '11:57:45', actor: 'ANALYST' as const, level: 'INFO' as const, summary: 'BTCUSDT candidate detected: PULLBACK_RECLAIM (conf: 0.78)' },
    { id: '3', at: '11:57:48', actor: 'STRATEGIST' as const, level: 'INFO' as const, summary: 'BTCUSDT trade thesis generated (Stop: 110,000, TP: 118,000)' },
    { id: '4', at: '11:57:50', actor: 'RISK' as const, level: 'INFO' as const, summary: 'Approved risk: 0.25% ($25.00), isolated 2x leverage' },
    { id: '5', at: '11:57:51', actor: 'POLICY' as const, level: 'INFO' as const, summary: 'Strategy cell active; reservation res_8f12 committed' },
    { id: '6', at: '11:57:52', actor: 'EXECUTION' as const, level: 'SUCCESS' as const, summary: 'Order submitted to venue -> FILLED @ 112,450.00' },
    { id: '7', at: '11:57:55', actor: 'POSITION' as const, level: 'SUCCESS' as const, summary: 'BTCUSDT LONG position open and protected' },
  ];

  const safeIdx = Math.min(selectedIndex, items.length - 1);

  return (
    <Box flexDirection="column" gap={1} paddingX={1}>
      <Box justifyContent="space-between">
        <Text bold color="cyan">OPERATIONAL EVENT TIMELINE (CHRONOLOGICAL)</Text>
        <Text color="gray">FOLLOW: <Text color="green">ON</Text></Text>
      </Box>

      <Box flexDirection="column">
        <Text color="gray">   TIME      LEVEL    ACTOR         EVENT SUMMARY</Text>
        {items.map((item, idx) => {
          const isSel = idx === safeIdx;
          return (
            <Text key={item.id} color={isSel ? 'black' : undefined} backgroundColor={isSel ? 'cyan' : undefined}>
              {isSel ? ' >' : '  '} {item.at.padEnd(9)} <Text color={isSel ? 'black' : levelColor(item.level)}>{item.level.padEnd(8)}</Text> <Text color={isSel ? 'black' : actorColor(item.actor)}>{item.actor.padEnd(13)}</Text> {item.summary}
            </Text>
          );
        })}
      </Box>
    </Box>
  );
};
