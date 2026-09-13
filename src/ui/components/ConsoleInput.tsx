import React from 'react';
import { Box, Text } from 'ink';
import { Divider } from '../../components/ui/divider/index.js';
import { Spinner } from '../../components/ui/spinner/index.js';
import { TextInput } from '../../components/ui/text-input/index.js';

export interface ConsoleInputProps {
  readonly value: string;
  readonly busy: boolean;
  readonly focused?: boolean;
  readonly statusText?: string;
  readonly spinner?: string;
  readonly onSubmit: (value: string) => void;
  readonly onChange: (value: string) => void;
  readonly onHistoryUp?: () => void;
  readonly onHistoryDown?: () => void;
  readonly onEscape?: () => void;
}

const PLACEHOLDER = 'Ask the agent, run /command, or ↑/↓ for history...';

const handleInputEscape = (p: ConsoleInputProps): void => {
  if (p.value.length > 0) p.onChange('');
  p.onEscape?.();
};

export const ConsoleInput = (p: ConsoleInputProps): React.JSX.Element => {
  const isFocused = !p.busy && (p.focused ?? true);

  return (
    <Box flexDirection="column" marginTop={0}>
      <Divider style="single" />
      <Box alignItems="center">
        {p.busy ? (
          <Box alignItems="center">
            <Box marginRight={1}>
              <Spinner type="dots" />
            </Box>
            <Text color="gray" italic>Agent is working...</Text>
          </Box>
        ) : (
          <TextInput
            value={p.value}
            onChange={p.onChange}
            onSubmit={p.onSubmit}
            placeholder={PLACEHOLDER}
            focus={isFocused}
            onUpArrow={p.onHistoryUp}
            onDownArrow={p.onHistoryDown}
            onEscape={() => handleInputEscape(p)}
          />
        )}
      </Box>
      {p.busy && p.statusText ? (
        <Text color="yellow" italic wrap="truncate">
          {'  ↳ '}{p.statusText}
        </Text>
      ) : null}
    </Box>
  );
};

