import React from 'react';
import { Box, Text } from 'ink';
import { WORKSPACE_TABS, type WorkspaceTab } from '../types.js';
import { KeyHint, type KeyHintItem } from '../../components/ui/key-hint/index.js';
import { Badge } from '../../components/ui/badge/index.js';

export interface ConsoleFooterProps {
  readonly activeTab: WorkspaceTab;
  readonly commandMode?: boolean;
}

const FOOTER_KEYS: readonly KeyHintItem[] = [
  { key: '1-0', label: 'Tabs' },
  { key: '↑/↓', label: 'History' },
  { key: 'PgUp/Dn', label: 'Scroll' },
  { key: 'Enter', label: 'Send' },
  { key: '/help', label: 'Help' },
  { key: 'Ctrl+P', label: 'Pause' },
  { key: 'Ctrl+C', label: 'Quit' },
];

export const TabsBar = ({ activeTab }: { readonly activeTab: WorkspaceTab }): React.JSX.Element => (
  <Box gap={1}>
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
    <Box justifyContent="space-between" alignItems="center">
      <KeyHint keys={[...FOOTER_KEYS]} />
      {commandMode ? <Badge variant="warning">COMMAND MODE</Badge> : <Text color="gray" italic>Not financial advice.</Text>}
    </Box>
  </Box>
);

