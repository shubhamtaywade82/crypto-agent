import React from 'react';
import { Box, Text } from 'ink';
import { Badge, type BadgeVariant } from '../../components/ui/badge/index.js';
import { Divider } from '../../components/ui/divider/index.js';
import type { ActivityTimelineItem } from '../types.js';

export interface EventsViewProps {
  readonly timeline: readonly ActivityTimelineItem[];
  readonly selectedIndex: number;
}

const badgeVariant = (lvl: string): BadgeVariant => {
  switch (lvl) {
    case 'SUCCESS': return 'success';
    case 'WARN': return 'warning';
    case 'ERROR': return 'error';
    default: return 'info';
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

const TimelineTable = (p: { readonly timeline: readonly ActivityTimelineItem[]; readonly safeIdx: number }): React.JSX.Element => (
  <Box flexDirection="column" gap={0}>
    <Text color="gray">   TIME      LEVEL    ACTOR         EVENT SUMMARY</Text>
    <Divider style="single" />
    {p.timeline.map((item, idx) => {
      const isSel = idx === p.safeIdx;
      return (
        <Box key={item.id} gap={1} alignItems="center">
          <Text color={isSel ? 'cyan' : 'gray'}>{isSel ? '>' : ' '}</Text>
          <Text color="gray">{item.at}</Text>
          <Badge variant={badgeVariant(item.level)}>{item.level}</Badge>
          <Text color={actorColor(item.actor)}>{item.actor.padEnd(11)}</Text>
          <Text color={isSel ? 'cyan' : 'white'} wrap="truncate">{item.summary}</Text>
        </Box>
      );
    })}
  </Box>
);

export const EventsView = ({ timeline, selectedIndex }: EventsViewProps): React.JSX.Element => {
  const safeIdx = Math.min(selectedIndex, Math.max(0, timeline.length - 1));
  const selected = timeline[safeIdx];

  return (
    <Box flexDirection="column" gap={1} paddingX={1}>
      <Box justifyContent="space-between">
        <Text bold color="cyan">ACTIVITY TRANSCRIPT (CHRONOLOGICAL)</Text>
        <Text color="gray">{timeline.length} events</Text>
      </Box>
      {timeline.length === 0 ? (
        <Text color="gray" italic>Waiting for activity — /scan, /pipeline SYM, EventCouncil, or auto-scan</Text>
      ) : (
        <>
          <TimelineTable timeline={timeline} safeIdx={safeIdx} />
          {selected?.detail ? <Text color="white">{selected.detail}</Text> : null}
        </>
      )}
    </Box>
  );
};
