import React from 'react';
import { useApp } from 'ink';
import { AppShell } from './AppShell.js';

export {
  renderMarkdown, formatToolArgs, formatToolResult, formatThoughtPreview,
} from './chat-shared.js';

export const App = (): React.JSX.Element => {
  const { exit } = useApp();
  return <AppShell exit={exit} />;
};
