import React from 'react';
import { Text, Box, useStdout } from 'ink';
import { darkTheme } from '../_core.js';
import type { InkUITheme } from '../_core.js';

export type DividerStyle = 'single' | 'double' | 'dashed' | 'bold';

/** Shell `paddingX={1}` eats two columns; lines at stdout.width wrap a leftover `──`. */
export const SHELL_GUTTER = 2;

export const fitCols = (termWidth: number, maxWidth?: number): number => {
  const inner = Math.max(8, termWidth - SHELL_GUTTER);
  return maxWidth !== undefined ? Math.min(inner, maxWidth) : inner;
};

export const dividerLine = (char: string, cols: number, title?: string): string => {
  if (!title) return char.repeat(cols);
  const prefix = `${char}${char} `;
  const rest = cols - prefix.length - title.length - 1;
  const line = `${prefix}${title} ${char.repeat(Math.max(0, rest))}`;
  return line.length <= cols ? line : line.slice(0, cols);
};

export interface DividerProps {
  title?: string;
  style?: DividerStyle;
  /** Defaults to terminal width */
  width?: number;
  theme?: InkUITheme;
}

const CHARS: Record<DividerStyle, string> = {
  single: '─',
  double: '═',
  dashed: '╌',
  bold:   '━',
};

export const Divider: React.FC<DividerProps> = ({
  title,
  style = 'single',
  width,
  theme = darkTheme,
}) => {
  const { stdout } = useStdout();
  const cols = width ?? fitCols(stdout?.columns ?? 80);
  const line = dividerLine(CHARS[style], cols, title);
  return (
    <Box width={cols} flexShrink={0} overflow="hidden">
      <Text wrap="truncate" color={theme.colors.border}>{line}</Text>
    </Box>
  );
};
