import React from 'react';
import { Box, Text } from 'ink';
import type { TranscriptEntry } from '../transcript.js';
import { actorColor } from '../transcript.js';

export interface TranscriptStripProps {
  readonly entries: readonly TranscriptEntry[];
  readonly limit?: number;
}

const rule = (): string => '─'.repeat(Math.max(20, (process.stdout.columns || 80) - 6));

export const TranscriptStrip = ({ entries, limit = 3 }: TranscriptStripProps): React.JSX.Element | null => {
  const recent = entries.slice(-limit);
  if (recent.length === 0) return null;

  return (
    <Box flexDirection="column" marginTop={1}>
      <Text color="gray">{rule()}</Text>
      <Text bold color="gray">LIVE TRANSCRIPT (last {recent.length}) — tab 9 for full stream</Text>
      {recent.map((e) => (
        <Text key={e.id} wrap="truncate">
          <Text color="gray">[{e.at}] </Text>
          <Text color={actorColor(e.actor)}>{e.actor.padEnd(10)}</Text>
          <Text> {e.title}</Text>
          {e.lines[0] ? <Text color="gray"> — {e.lines[0]}</Text> : null}
        </Text>
      ))}
    </Box>
  );
};
