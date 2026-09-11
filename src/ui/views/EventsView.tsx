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
  const items = timeline;
  const safeIdx = Math.min(selectedIndex, Math.max(0, items.length - 1));

  return (
    <Box flexDirection="column" gap={1} paddingX={1}>
      <Box justifyContent="space-between">
        <Text bold color="cyan">ACTIVITY TRANSCRIPT (CHRONOLOGICAL)</Text>
        <Text color="gray">FOLLOW: <Text color="green">ON</Text></Text>
      </Box>
      {items.length === 0 ? (
        <Text color="gray" italic>Waiting for activity — /scan, /pipeline SYM, or auto-scan will populate this stream</Text>
      ) : (
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
      )}
    </Box>
  );
};
