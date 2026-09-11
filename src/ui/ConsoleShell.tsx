import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Box } from 'ink';
import { ConsoleHeader } from './components/ConsoleHeader.js';
import { WorkspaceRouter } from './workspace-router.js';
import { ConsoleInput } from './components/ConsoleInput.js';
import { ConsoleFooter } from './components/ConsoleFooter.js';
import { useConsoleState, useConsoleSubmit } from './use-console-state.js';
import { useTerminalNav } from './use-terminal-nav.js';
import { usePromptHistoryNavigation } from './history.js';
import { getKernel } from '../kernel.js';
import { deriveCircuitState } from '../domain/risk/risk-config.js';
import type { BrokerPosition } from '../infrastructure/broker/broker.js';
import type { ActivityTimelineItem, WorkspaceTab } from './types.js';
import type { TranscriptEntry } from './transcript.js';

const entryToTimelineItem = (e: TranscriptEntry): ActivityTimelineItem => {
  const actor = e.actor === 'LEARNING' ? 'SYSTEM' : e.actor;
  const text = `${e.title} ${e.lines.join(' ')}`;
  let level: ActivityTimelineItem['level'] = 'INFO';
  if (text.includes('ERR') || text.includes('REJECT') || text.includes('HALT')) level = 'ERROR';
  else if (text.includes('WARN') || text.includes('BREACH')) level = 'WARN';
  else if (text.includes('FILLED') || text.includes('APPROVED') || text.includes('PASSED')) level = 'SUCCESS';
  return { id: e.id, at: e.at, actor, level, summary: `${e.title}: ${e.lines[0] ?? ''}`, detail: e.lines.slice(1).join('\n') };
};

const usePositionsPoll = (): readonly BrokerPosition[] => {
  const [positions, setPositions] = useState<readonly BrokerPosition[]>([]);
  useEffect(() => {
    const fetchPositions = (): void => {
      void getKernel().broker.getPositions().then(setPositions).catch(() => {});
    };
    fetchPositions();
    const timer = setInterval(fetchPositions, 2000);
    return (): void => clearInterval(timer);
  }, []);
  return positions;
};

const useConsoleNav = (s: ReturnType<typeof useConsoleState>, inputVal: string, setInputVal: (v: string) => void, exit: () => void): {
  readonly nav: ReturnType<typeof useTerminalNav>;
  readonly onSubmit: () => void;
} => {
  const k = getKernel();
  const nav = useTerminalNav({
    isBusy: s.chat.isBusy, inputHasText: inputVal.length > 0,
    onTogglePause: () => s.setAuto((a) => ({ ...a, enabled: !a.enabled })),
    onKillSwitch: () => { k.killSwitch.halt('Console user emergency halt', 'operator'); },
    onQuit: exit,
    onEnterInspect: (tab: WorkspaceTab) => {
      if (tab === 'opps' || tab === 'orders' || tab === 'positions') nav.openModal({ type: 'decision_trace' });
    },
  });
  const submit = useConsoleSubmit({
    s, inputVal, setInputVal, filterMode: false,
    setFilterQuery: () => undefined, setFilterMode: () => undefined, exit,
  });
  const onSubmit = useCallback((): void => { submit(); nav.setCommandMode(false); }, [submit, nav]);
  return { nav, onSubmit };
};

export const ConsoleShell = (p: { readonly exit: () => void }): React.JSX.Element => {
  const s = useConsoleState(p.exit);
  const [inputVal, setInputVal] = useState('');
  const positions = usePositionsPoll();
  const { handleUp, handleDown } = usePromptHistoryNavigation(s.history, inputVal, setInputVal);
  const { nav, onSubmit } = useConsoleNav(s, inputVal, setInputVal, p.exit);
  const k = getKernel();

  const timeline = useMemo(() => s.transcript.map(entryToTimelineItem), [s.transcript]);
  const circuit = deriveCircuitState(s.port.dailyLossPercent, s.port.drawdownPercent, s.port.lossStreak, k.limits);
  const agentState = s.chat.isBusy ? 'BUSY' : s.auto.enabled ? 'AUTONOMOUS' : 'PAUSED';

  return (
    <Box flexDirection="column" paddingX={1} gap={0}>
      <ConsoleHeader
        venue={k.venue} agentState={agentState} marketOk={s.streamLive}
        executionOk={!k.killSwitch.halted} circuit={circuit} killSwitchHalted={k.killSwitch.halted}
        cycle={1} time={new Date().toLocaleTimeString('en-IN', { hour12: false })}
        equity={s.port.equity} dailyPnl={s.port.dailyRealizedPnl}
      />
      <WorkspaceRouter
        activeTab={nav.activeTab} selectedIndex={nav.selectedIndex} activeModal={nav.activeModal}
        closeModal={nav.closeModal} positions={positions} timeline={timeline} focusSymbol={s.focusSymbol}
        opportunities={s.opportunities}
      />
      <ConsoleInput
        value={inputVal} busy={s.chat.isBusy} focused={nav.commandMode || inputVal.length > 0}
        statusText={s.chat.status} spinner={s.spinner}
        onSubmit={onSubmit} onChange={setInputVal} onHistoryUp={handleUp} onHistoryDown={handleDown}
        onEscape={() => { setInputVal(''); nav.closeModal(); }}
      />
      <ConsoleFooter activeTab={nav.activeTab} commandMode={nav.commandMode} />
    </Box>
  );
};
