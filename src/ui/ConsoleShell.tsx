import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Box, useStdout } from 'ink';
import { ConsoleHeader } from './components/ConsoleHeader.js';
import { WorkspaceRouter } from './workspace-router.js';
import { ConsoleInput } from './components/ConsoleInput.js';
import { ConsoleFooter, TabsBar } from './components/ConsoleFooter.js';
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

const useConsoleNav = (
  s: ReturnType<typeof useConsoleState>,
  inputVal: string,
  setInputVal: (v: string) => void,
  exit: () => void
): {
  readonly nav: ReturnType<typeof useTerminalNav>;
  readonly onSubmit: () => void;
} => {
  const k = getKernel();
  const nav = useTerminalNav({
    isBusy: s.chat.isBusy,
    inputEmpty: inputVal.length === 0,
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
    setActiveTab: nav.setActiveTab,
  });
  const onSubmit = useCallback((): void => { submit(); }, [submit]);
  return { nav, onSubmit };
};

const useConsoleHistoryControls = (
  history: ReturnType<typeof useConsoleState>['history'],
  inputVal: string,
  setInputVal: (v: string) => void,
  closeModal: () => void
): {
  readonly onHistoryUp: () => void;
  readonly onHistoryDown: () => void;
  readonly onEscape: () => void;
} => {
  const { handleUp, handleDown } = usePromptHistoryNavigation(history, inputVal, setInputVal);
  const onHistoryUp = useCallback((): void => { handleUp(); }, [handleUp]);
  const onHistoryDown = useCallback((): void => { handleDown(); }, [handleDown]);
  const onEscape = useCallback((): void => { setInputVal(''); closeModal(); }, [closeModal, setInputVal]);
  return { onHistoryUp, onHistoryDown, onEscape };
};

interface ConsoleMetrics {
  readonly timeline: readonly ActivityTimelineItem[];
  readonly circuit: ReturnType<typeof deriveCircuitState>;
  readonly agentState: 'BUSY' | 'AUTONOMOUS' | 'PAUSED';
}

const useConsoleMetrics = (s: ReturnType<typeof useConsoleState>, k: ReturnType<typeof getKernel>): ConsoleMetrics => {
  const timeline = useMemo(() => s.transcript.map(entryToTimelineItem), [s.transcript]);
  const circuit = deriveCircuitState(s.port.dailyLossPercent, s.port.drawdownPercent, s.port.lossStreak, k.limits);
  const agentState = s.chat.isBusy ? 'BUSY' : s.auto.enabled ? 'AUTONOMOUS' : 'PAUSED';
  return { timeline, circuit, agentState };
};

const ConsoleWorkspaceView = (p: {
  readonly nav: ReturnType<typeof useTerminalNav>;
  readonly s: ReturnType<typeof useConsoleState>;
  readonly positions: readonly BrokerPosition[];
  readonly timeline: readonly ActivityTimelineItem[];
  readonly height: number;
}): React.JSX.Element => (
  <Box flexDirection="column" height={p.height} overflow="hidden">
    <WorkspaceRouter
      activeTab={p.nav.activeTab} selectedIndex={p.nav.selectedIndex} activeModal={p.nav.activeModal}
      closeModal={p.nav.closeModal} positions={p.positions} timeline={p.timeline} focusSymbol={p.s.focusSymbol}
      opportunities={p.s.opportunities} markets={p.s.markets} isScanning={p.s.chat.isBusy}
      pipelineSnapshots={p.s.pipelineSnapshots} transcript={p.s.transcript}
      chat={p.s.chat} history={p.s.history} streamLive={p.s.streamLive}
      autoEnabled={p.s.auto.enabled} port={p.s.port}
    />
  </Box>
);

export const ConsoleShell = (p: { readonly exit: () => void }): React.JSX.Element => {
  const s = useConsoleState(p.exit);
  const [inputVal, setInputVal] = useState('');
  const positions = usePositionsPoll();
  const { nav, onSubmit } = useConsoleNav(s, inputVal, setInputVal, p.exit);
  const { onHistoryUp, onHistoryDown, onEscape } = useConsoleHistoryControls(s.history, inputVal, setInputVal, nav.closeModal);
  const k = getKernel();
  const { timeline, circuit, agentState } = useConsoleMetrics(s, k);
  const { stdout } = useStdout();
  const h = Math.max(8, (stdout.rows || process.stdout.rows || 24) - 8);

  return (
    <Box flexDirection="column" paddingX={1} gap={0} height={stdout.rows || undefined} overflow="hidden">
      <ConsoleHeader
        venue={k.venue} agentState={agentState} marketOk={s.streamLive}
        executionOk={!k.killSwitch.halted} circuit={circuit} killSwitchHalted={k.killSwitch.halted}
        cycle={s.pipelineCycle} equity={s.port.equity} dailyPnl={s.port.dailyRealizedPnl}
      />
      <TabsBar activeTab={nav.activeTab} />
      <ConsoleWorkspaceView nav={nav} s={s} positions={positions} timeline={timeline} height={h} />
      <ConsoleInput
        value={inputVal} busy={s.chat.isBusy} focused={!s.chat.isBusy}
        statusText={s.chat.status} spinner={s.spinner}
        onSubmit={onSubmit} onChange={setInputVal} onHistoryUp={onHistoryUp} onHistoryDown={onHistoryDown}
        onEscape={onEscape}
      />
      <ConsoleFooter activeTab={nav.activeTab} commandMode={inputVal.startsWith('/')} />
    </Box>
  );
};
