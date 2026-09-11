export type WorkspaceTab =
  | 'overview'
  | 'agent'
  | 'opps'
  | 'positions'
  | 'orders'
  | 'risk'
  | 'strategies'
  | 'learning'
  | 'events'
  | 'system';

export interface TabDescriptor {
  readonly id: WorkspaceTab;
  readonly key: string;
  readonly label: string;
  readonly shortLabel: string;
}

export const WORKSPACE_TABS: readonly TabDescriptor[] = [
  { id: 'overview', key: '1', label: '1 Overview', shortLabel: '1Overview' },
  { id: 'agent', key: '2', label: '2 Agent', shortLabel: '2Agent' },
  { id: 'opps', key: '3', label: '3 Opportunities', shortLabel: '3Opps' },
  { id: 'positions', key: '4', label: '4 Positions', shortLabel: '4Pos' },
  { id: 'orders', key: '5', label: '5 Orders', shortLabel: '5Orders' },
  { id: 'risk', key: '6', label: '6 Risk', shortLabel: '6Risk' },
  { id: 'strategies', key: '7', label: '7 Strategies', shortLabel: '7Strat' },
  { id: 'learning', key: '8', label: '8 Learning', shortLabel: '8Learn' },
  { id: 'events', key: '9', label: '9 Events', shortLabel: '9Events' },
  { id: 'system', key: '0', label: '0 System', shortLabel: '0Sys' },
] as const;

export type ModalType = 'decision_trace' | 'order_fsm' | 'position_detail' | 'help';

export interface ActiveModal {
  readonly type: ModalType;
  readonly targetId?: string;
}

export interface ActivityTimelineItem {
  readonly id: string;
  readonly at: string;
  readonly actor: 'SYSTEM' | 'MARKET' | 'ANALYST' | 'STRATEGIST' | 'RISK' | 'POLICY' | 'EXECUTION' | 'FILL' | 'POSITION' | 'USER' | 'AGENT';
  readonly level: 'INFO' | 'WARN' | 'ERROR' | 'SUCCESS';
  readonly summary: string;
  readonly detail?: string;
}
