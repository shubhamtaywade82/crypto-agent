import React from 'react';
import { Box, Text } from 'ink';
import { Divider } from '../../components/ui/divider/index.js';
import type { TranscriptEntry } from '../transcript.js';
import { actorColor } from '../transcript.js';

export interface TranscriptStripProps {
  readonly entries: readonly TranscriptEntry[];
  readonly limit?: number;
}

export interface AgentConsoleFeedProps {
  readonly entries: readonly TranscriptEntry[];
  readonly limit?: number;
  readonly scrollOffset?: number;
  readonly autoScroll?: boolean;
}

const TranscriptLines = ({ entries }: { readonly entries: readonly TranscriptEntry[] }): React.JSX.Element => (
  <>
    {entries.map((e) => (
      <Text key={e.id} wrap="truncate">
        <Text color="gray">{e.at} </Text>
        <Text color={actorColor(e.actor)}>[{e.actor}]</Text>
        <Text> {e.title}</Text>
        {e.lines[0] ? <Text color="gray"> — {e.lines[0]}</Text> : null}
      </Text>
    ))}
  </>
);

export const AgentConsoleFeed = ({
  entries, limit = 10, scrollOffset = 0, autoScroll = true,
}: AgentConsoleFeedProps): React.JSX.Element => {
  const end = Math.max(0, entries.length - scrollOffset);
  const start = Math.max(0, end - limit);
  const visible = entries.slice(start, end);

  return (
    <Box flexDirection="column" flexGrow={1}>
      <Box justifyContent="space-between">
        <Text bold color="cyan">AGENT CONSOLE</Text>
        <Text color="gray">Showing: All │ Auto-scroll: <Text color={autoScroll ? 'green' : 'yellow'}>{autoScroll ? 'On' : 'Off'}</Text></Text>
      </Box>
      {visible.length === 0 ? (
        <Text color="gray" italic>Waiting for pipeline, scan, or chat activity…</Text>
      ) : (
        <TranscriptLines entries={visible} />
      )}
      <Text color="gray" italic>PgUp/Dn scroll │ tab 9 Events</Text>
    </Box>
  );
};

export const TranscriptStrip = ({ entries, limit = 3 }: TranscriptStripProps): React.JSX.Element | null => {
  const recent = entries.slice(-limit);
  if (recent.length === 0) return null;

  return (
    <Box flexDirection="column" marginTop={1}>
      <Divider style="single" />
      <Text bold color="gray">LIVE TRANSCRIPT (last {recent.length}) — tab 9 for full stream</Text>
      <TranscriptLines entries={recent} />
    </Box>
  );
};
