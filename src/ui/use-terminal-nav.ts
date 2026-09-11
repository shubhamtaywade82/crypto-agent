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

interface NavHandlers {
  readonly activeTab: WorkspaceTab;
  readonly selectedIndex: number;
  readonly activeModal: ActiveModal | null;
  readonly isBusy: boolean;
  readonly setSelectedIndex: React.Dispatch<React.SetStateAction<number>>;
  readonly closeModal: () => void;
  readonly openModal: (m: ActiveModal) => void;
  readonly cycleTab: (delta: number) => void;
  readonly onTogglePause: () => void;
  readonly onKillSwitch: () => void;
  readonly onQuit: () => void;
  readonly onEnterInspect?: (tab: WorkspaceTab, selectedIdx: number) => void;
}

const handleNavInput = (input: string, key: Parameters<Parameters<typeof useInput>[0]>[1], h: NavHandlers): void => {
  if (h.isBusy) return;
  if (h.activeModal) {
    if (key.escape || input === 'q') h.closeModal();
    return;
  }
  if (key.tab) {
    h.cycleTab(key.shift ? -1 : 1);
    return;
  }
  if (key.pageUp || (key.ctrl && (key.upArrow || input === 'k' || input === '\x0b'))) {
    h.setSelectedIndex((i) => Math.max(0, i - 1));
    return;
  }
  if (key.pageDown || (key.ctrl && (key.downArrow || input === 'j' || input === '\n'))) {
    h.setSelectedIndex((i) => Math.max(0, i + 1));
    return;
  }
  if (key.ctrl && (input === 'p' || input === '\x10')) { h.onTogglePause(); return; }
  if (key.ctrl && (input === 'k' || input === '\x0b')) { h.onKillSwitch(); return; }
  if (key.ctrl && input === 'q') { h.onQuit(); return; }
  if (key.ctrl && (input === 'h' || input === '\x08')) { h.openModal({ type: 'help' }); return; }
  if (key.ctrl && (input === 'i' || key.return) && h.onEnterInspect) {
    h.onEnterInspect(h.activeTab, h.selectedIndex);
  }
};

export const useTerminalNav = (opts: {
  readonly isBusy: boolean;
  readonly onTogglePause: () => void;
  readonly onKillSwitch: () => void;
  readonly onQuit: () => void;
  readonly onEnterInspect?: (tab: WorkspaceTab, selectedIdx: number) => void;
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
    activeTab, selectedIndex, activeModal, isBusy: opts.isBusy,
    setSelectedIndex, closeModal, openModal, cycleTab,
    onTogglePause: opts.onTogglePause, onKillSwitch: opts.onKillSwitch, onQuit: opts.onQuit,
    onEnterInspect: opts.onEnterInspect,
  }));

  return {
    activeTab, setActiveTab, selectedIndex, setSelectedIndex,
    activeModal, openModal, closeModal, commandMode, setCommandMode,
  };
};
