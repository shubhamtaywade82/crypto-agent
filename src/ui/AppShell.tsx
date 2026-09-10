import React from 'react';
import { Box, Text } from 'ink';
import { WatcherPanel } from './WatcherPanel.js';
import { KernelDashboard } from './KernelDashboard.js';
import { ChatPanel } from './ChatPanel.js';
import { Header, PromptInput } from './app-chrome.js';
import { useShellState, useSubmitHandler } from './use-shell-state.js';
import { usePromptHistoryNavigation } from './history.js';
import { kernelWatchSymbols } from '../kernel-streams.js';

const DEFAULT_SYMBOLS = kernelWatchSymbols();

export const AppShell = (p: { readonly exit: () => void }): React.JSX.Element => {
  const s = useShellState(p.exit);
  const { inputVal, setInputVal, handleUp, handleDown } = usePromptHistoryNavigation(s.history);
  const handleSubmit = useSubmitHandler(s, inputVal, setInputVal, p.exit);
  const div = <Text color="gray">{'─'.repeat(Math.max(20, (process.stdout.columns || 80) - 6))}</Text>;
  return (
    <Box flexDirection="column" paddingX={1}>
      {s.mode === 'chat' && (
        <ChatPanel messages={s.chat.messages} busy={s.chat.isBusy} status={s.chat.status} steps={s.chat.steps} response={s.chat.response} spinner={s.spinner} />
      )}
      <Box flexDirection="column" borderStyle="round" borderColor="cyan" paddingX={1} marginTop={1}>
        <Header port={s.port} auto={s.auto} mode={s.mode} />{div}
        {s.mode === 'ops' && (
          <KernelDashboard symbols={DEFAULT_SYMBOLS} focusSymbol={s.focusSymbol} activity={s.activity} streamLive={s.streamLive} />
        )}
        <WatcherPanel orchestrator={s.orchestrator} />{div}
        <PromptInput value={inputVal} busy={s.chat.isBusy} onSubmit={handleSubmit} onChange={setInputVal} onHistoryUp={handleUp} onHistoryDown={handleDown} />
      </Box>
    </Box>
  );
};
