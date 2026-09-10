import React from 'react';
import { Box, Static, Text } from 'ink';
import { formatThoughtPreview, formatToolArgs, renderMarkdown, type AgentStep, type ChatMessage } from './chat-shared.js';

const StepList = ({ steps, keyPrefix }: { steps: readonly AgentStep[]; keyPrefix: string }): React.JSX.Element => (
  <Box flexDirection="column">
    {steps.map((s, idx) => s.type === 'tool' ? (
      <Text key={`${keyPrefix}-${idx}`} color="green">🛠️ {s.tool.name}({formatToolArgs(s.tool.args)})</Text>
    ) : (
      <Text key={`${keyPrefix}-${idx}`} color="gray" italic>{formatThoughtPreview(s.content)}</Text>
    ))}
  </Box>
);

export const ChatPanel = (p: {
  readonly messages: readonly ChatMessage[];
  readonly busy: boolean;
  readonly status: string;
  readonly steps: readonly AgentStep[];
  readonly response: string;
  readonly spinner: string;
}): React.JSX.Element => (
  <>
    <Static items={[...p.messages]}>{(m) => (
      <Box key={m.id} marginY={1} flexDirection="column">
        {m.role === 'user' ? <Text bold color="blue">👤 {m.content}</Text> : null}
        {m.steps && <StepList steps={m.steps} keyPrefix={m.id} />}
        {m.content && m.role !== 'user' && <Text>{renderMarkdown(m.content)}</Text>}
      </Box>
    )}</Static>
    {p.busy && (
      <Box marginY={1} flexDirection="column">
        <Text color="yellow">{p.spinner} {p.status}</Text>
        <StepList steps={p.steps} keyPrefix="live" />
        {p.response && <Text>{renderMarkdown(p.response)}</Text>}
      </Box>
    )}
  </>
);
