import React from 'react';
import { Box, Text, useApp, useInput } from 'ink';
import { Divider } from '../../components/ui/divider/index.js';
import { Spinner } from '../../components/ui/spinner/index.js';

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

const useInputDispatcher = (p: ConsoleInputProps, exit: () => void): void => {
  useInput((input, key) => {
    if (key.ctrl && (input === 'c' || input === '\u0003')) { exit(); return; }
    if (p.busy) return;
    if (key.upArrow) { p.onHistoryUp?.(); return; }
    if (key.downArrow) { p.onHistoryDown?.(); return; }
    if (key.escape) {
      if (p.value.length > 0) p.onChange('');
      p.onEscape?.();
      return;
    }
    if (key.return) { p.onSubmit(p.value); return; }
    if (key.backspace || key.delete) {
      p.onChange(p.value.slice(0, -1));
      return;
    }
    // Filter non-printable control keys to prevent garbled prompt input
    if (!key.ctrl && !key.meta && !key.tab && !key.leftArrow && !key.rightArrow && !key.pageUp && !key.pageDown && input) {
      p.onChange(p.value + input);
    }
  });
};

const placeholder = 'Ask the agent, run /command, or ↑/↓ for history...';

export const ConsoleInput = (p: ConsoleInputProps): React.JSX.Element => {
  const { exit } = useApp();
  useInputDispatcher(p, exit);

  return (
    <Box flexDirection="column" marginTop={0}>
      <Divider style="single" />
      <Box alignItems="center">
        {p.busy ? (
          <Box marginRight={1}>
            <Spinner type="dots" />
          </Box>
        ) : (
          <Text bold color="cyan">{'> '}</Text>
        )}
        <Text wrap="truncate">
          {p.value.length > 0 ? (
            <Text color="white">{p.value}</Text>
          ) : (
            <Text color="gray" italic>{p.busy ? 'Agent is working...' : placeholder}</Text>
          )}
          {!p.busy && <Text color="cyan">█</Text>}
        </Text>
      </Box>
      {p.busy && p.statusText ? <Text color="yellow" italic wrap="truncate">  ↳ {p.statusText}</Text> : null}
    </Box>
  );
};

