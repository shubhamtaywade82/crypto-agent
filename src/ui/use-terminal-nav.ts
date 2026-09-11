import { useCallback, useState } from 'react';
import { useInput } from 'ink';
import type { ActiveModal, WorkspaceTab } from './types.js';
import { WORKSPACE_TABS } from './types.js';

export interface TerminalNavState {
  readonly activeTab: WorkspaceTab;
  readonly setActiveTab: (tab: WorkspaceTab) => void;
  readonly selectedIndex: number;
  readonly setSelectedIndex: (idx: number) => void;
  readonly activeModal: ActiveModal | null;
  readonly openModal: (modal: ActiveModal) => void;
  readonly closeModal: () => void;
  readonly commandMode: boolean;
  readonly setCommandMode: (on: boolean) => void;
}

const TAB_KEYS: Record<string, WorkspaceTab> = {
  '1': 'overview',
  '2': 'agent',
  '3': 'opps',
  '4': 'positions',
  '5': 'orders',
  '6': 'risk',
  '7': 'strategies',
  '8': 'learning',
  '9': 'events',
  '0': 'system',
};

interface NavHandlers {
  readonly activeTab: WorkspaceTab;
  readonly selectedIndex: number;
  readonly activeModal: ActiveModal | null;
  readonly isBusy: boolean;
  readonly inputHasText: boolean;
  readonly commandMode: boolean;
  readonly setActiveTab: (t: WorkspaceTab) => void;
  readonly setSelectedIndex: React.Dispatch<React.SetStateAction<number>>;
  readonly closeModal: () => void;
  readonly openModal: (m: ActiveModal) => void;
  readonly setCommandMode: (b: boolean) => void;
  readonly cycleTab: (delta: number) => void;
  readonly onTogglePause: () => void;
  readonly onKillSwitch: () => void;
  readonly onQuit: () => void;
  readonly onEnterInspect?: (tab: WorkspaceTab, selectedIdx: number) => void;
  readonly onSlashCommand?: (prefix: string) => void;
}

const handleNavInput = (input: string, key: Parameters<Parameters<typeof useInput>[0]>[1], h: NavHandlers): void => {
  if (h.isBusy) return;
  if (h.activeModal) { if (key.escape || input === 'q') h.closeModal(); return; }
  if (h.commandMode || h.inputHasText) {
    if (key.escape) h.setCommandMode(false);
    return;
  }
  if (TAB_KEYS[input]) { h.setActiveTab(TAB_KEYS[input]!); h.setSelectedIndex(0); return; }
  if (key.tab) { h.cycleTab(key.shift ? -1 : 1); return; }
  if (input === 'j' || key.downArrow) h.setSelectedIndex((i) => Math.max(0, i + 1));
  else if (input === 'k' || key.upArrow) h.setSelectedIndex((i) => Math.max(0, i - 1));
  else if (input === 'p') h.onTogglePause();
  else if (input === 'K') h.onKillSwitch();
  else if (input === '?' || input === 'h') h.openModal({ type: 'help' });
  else if (input === 'q') h.onQuit();
  else if (input === 'c') { h.setActiveTab('agent'); h.setCommandMode(true); }
  else if (input === ':' || input === '/') { h.setCommandMode(true); h.onSlashCommand?.(input); }
  else if (input === 'i') h.setCommandMode(true);
  else if (key.return && h.onEnterInspect) h.onEnterInspect(h.activeTab, h.selectedIndex);
};

export const useTerminalNav = (opts: {
  readonly isBusy: boolean;
  readonly inputHasText: boolean;
  readonly onTogglePause: () => void;
  readonly onKillSwitch: () => void;
  readonly onQuit: () => void;
  readonly onEnterInspect?: (tab: WorkspaceTab, selectedIdx: number) => void;
  readonly onSlashCommand?: (prefix: string) => void;
}): TerminalNavState => {
  const [activeTab, setActiveTab] = useState<WorkspaceTab>('overview');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [activeModal, setActiveModal] = useState<ActiveModal | null>(null);
  const [commandMode, setCommandMode] = useState(false);

  const closeModal = useCallback((): void => { setActiveModal(null); setCommandMode(false); }, []);
  const openModal = useCallback((modal: ActiveModal): void => { setActiveModal(modal); }, []);
  const cycleTab = useCallback((delta: number): void => {
    const idx = WORKSPACE_TABS.findIndex((t) => t.id === activeTab);
    const next = (idx + delta + WORKSPACE_TABS.length) % WORKSPACE_TABS.length;
    const found = WORKSPACE_TABS[next];
    if (found) { setActiveTab(found.id); setSelectedIndex(0); }
  }, [activeTab]);

  useInput((input, key) => handleNavInput(input, key, {
    activeTab, selectedIndex, activeModal, isBusy: opts.isBusy, inputHasText: opts.inputHasText,
    commandMode,
    setActiveTab, setSelectedIndex, closeModal, openModal, setCommandMode, cycleTab,
    onTogglePause: opts.onTogglePause, onKillSwitch: opts.onKillSwitch, onQuit: opts.onQuit,
    onEnterInspect: opts.onEnterInspect, onSlashCommand: opts.onSlashCommand,
  }));

  return {
    activeTab, setActiveTab, selectedIndex, setSelectedIndex,
    activeModal, openModal, closeModal, commandMode, setCommandMode,
  };
};
