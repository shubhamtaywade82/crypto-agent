import React from 'react';
import { Box, Text } from 'ink';

export interface BoxFrameProps {
  readonly title: string;
  readonly badge?: string;
  readonly badgeColor?: string;
  readonly children: React.ReactNode;
  readonly width?: number;
  readonly borderColor?: string;
  readonly paddingX?: number;
  readonly paddingY?: number;
}

export const BoxFrame = ({
  title, badge, badgeColor = 'cyan', children, width,
  borderColor = 'gray', paddingX = 1, paddingY = 0,
}: BoxFrameProps): React.JSX.Element => {
  const termWidth = width ?? Math.max(40, (process.stdout.columns || 80) - 4);
  const badgeText = badge ? `[${badge}] ` : '';
  const remaining = Math.max(2, termWidth - (`┌─ ${title} `.length + badgeText.length + 1));

  return (
    <Box flexDirection="column" marginY={0}>
      <Box>
        <Text color={borderColor}>┌─ </Text>
        <Text bold color="white">{title} </Text>
        {badge ? <Text color={badgeColor}>[{badge}] </Text> : null}
        <Text color={borderColor}>{'─'.repeat(remaining) + '┐'}</Text>
      </Box>
      <Box flexDirection="column" borderStyle="single" borderTop={false} borderColor={borderColor} paddingX={paddingX} paddingY={paddingY}>
        {children}
      </Box>
    </Box>
  );
};
