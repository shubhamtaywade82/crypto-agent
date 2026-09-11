import React from 'react';
import { Box, Text } from 'ink';
import { WORKSPACE_TABS, type WorkspaceTab } from '../types.js';

export interface ConsoleFooterProps {
  readonly activeTab: WorkspaceTab;
  readonly commandMode?: boolean;
}

export const TabsBar = ({ activeTab }: { readonly activeTab: WorkspaceTab }): React.JSX.Element => (
  <Box gap={1} paddingX={1}>
    {WORKSPACE_TABS.map((tab) => {
      const isActive = tab.id === activeTab;
      return (
        <Text key={tab.id} bold={isActive} color={isActive ? 'black' : 'gray'} backgroundColor={isActive ? 'cyan' : undefined}>
          {' '}{tab.label}{' '}
        </Text>
      );
    })}
  </Box>
);

export const ConsoleFooter = ({ commandMode }: ConsoleFooterProps): React.JSX.Element => (
  <Box flexDirection="column" marginTop={0}>
    <Box paddingX={1} justifyContent="space-between">
      <Text color="gray">
        <Text color="cyan">1-0</Text> Tabs │ <Text color="cyan">↑/↓</Text> History │ <Text color="cyan">PgUp/Dn</Text> Scroll │ <Text color="cyan">Enter</Text> Send │ <Text color="cyan">/help</Text> │ <Text color="cyan">Ctrl+P</Text> Pause │ <Text color="cyan">Ctrl+C</Text> Quit
      </Text>
      {commandMode ? <Text bold color="yellow">COMMAND MODE</Text> : <Text color="gray" italic>Not financial advice.</Text>}
    </Box>
  </Box>
);
