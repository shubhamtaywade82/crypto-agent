import React from 'react';
import { Box, Text } from 'ink';
import { WORKSPACE_TABS, type WorkspaceTab } from '../types.js';

export interface ConsoleFooterProps {
  readonly activeTab: WorkspaceTab;
  readonly commandMode?: boolean;
}

export const ConsoleFooter = ({ activeTab, commandMode }: ConsoleFooterProps): React.JSX.Element => (
  <Box flexDirection="column" marginTop={0}>
    <Box gap={1} paddingX={1} borderStyle="single" borderBottom={false} borderLeft={false} borderRight={false} borderColor="gray">
      {WORKSPACE_TABS.map((tab) => {
        const isActive = tab.id === activeTab;
        return (
          <Text
            key={tab.id}
            bold={isActive}
            color={isActive ? 'black' : 'gray'}
            backgroundColor={isActive ? 'cyan' : undefined}
          >
            {' '}{tab.label}{' '}
          </Text>
        );
      })}
    </Box>
    <Box paddingX={1} justifyContent="space-between">
      <Text color="gray">
        <Text color="cyan">Tab</Text> Next Pane │{' '}
        <Text color="cyan">j/k</Text> Navigate │{' '}
        <Text color="cyan">Enter</Text> Inspect │{' '}
        <Text color="cyan">Esc</Text> Back │{' '}
        <Text color="cyan">p</Text> Pause │{' '}
        <Text color="cyan">k</Text> Kill │{' '}
        <Text color="cyan">?</Text> Help │{' '}
        <Text color="cyan">q</Text> Quit
      </Text>
      {commandMode && (
        <Text bold color="yellow">COMMAND MODE (:)</Text>
      )}
    </Box>
  </Box>
);
