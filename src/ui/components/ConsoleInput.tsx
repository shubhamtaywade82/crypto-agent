import React from 'react';
import { Box, Text, useApp, useInput } from 'ink';

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
    if (p.busy || (p.focused === false && p.value.length === 0)) return;
    if (key.upArrow) p.onHistoryUp?.();
    else if (key.downArrow) p.onHistoryDown?.();
    else if (key.escape) p.onEscape?.();
    else if (key.return) p.onSubmit(p.value);
    else if (key.backspace || key.delete) p.onChange(p.value.slice(0, -1));
    else if (!key.ctrl && !key.meta && input) p.onChange(p.value + input);
  });
};

const placeholder = 'Ask the agent, inspect a decision, analyze a position, or issue a command...';

export const ConsoleInput = (p: ConsoleInputProps): React.JSX.Element => {
  const { exit } = useApp();
  useInputDispatcher(p, exit);

  return (
    <Box flexDirection="column" borderStyle="single" borderColor={p.busy ? 'yellow' : 'cyan'} paddingX={1} marginTop={0}>
      <Box>
        <Text bold color={p.busy ? 'yellow' : 'cyan'}>{p.busy ? `${p.spinner ?? '⠋'} ` : '> '}</Text>
        {p.value.length > 0 ? <Text color="white">{p.value}</Text> : <Text color="gray" italic>{placeholder}</Text>}
        {!p.busy && <Text color="cyan">█</Text>}
      </Box>
      {p.busy && p.statusText ? <Text color="yellow" italic>  ↳ {p.statusText}</Text> : null}
    </Box>
  );
};
