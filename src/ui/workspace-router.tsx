import React from 'react';
import { Box } from 'ink';
import type { ActiveModal, ActivityTimelineItem, WorkspaceTab } from './types.js';
import type { BrokerPosition } from '../infrastructure/broker/broker.js';
import type { MonitoredMarket, ScanOpportunity } from './scan-opportunities.js';
import type { PipelineSnapshots } from './pipeline-view.js';
import type { TranscriptEntry } from './transcript.js';
import type { useAgentChat } from './app-hooks.js';
import type { PromptHistory } from './history.js';
import { OverviewView } from './views/OverviewView.js';
import { AgentView } from './views/AgentView.js';
import { OpportunitiesView } from './views/OpportunitiesView.js';
import { PositionsView } from './views/PositionsView.js';
import { OrdersView } from './views/OrdersView.js';
import { RiskView } from './views/RiskView.js';
import { StrategiesView } from './views/StrategiesView.js';
import { LearningView } from './views/LearningView.js';
import { EventsView } from './views/EventsView.js';
import { SystemView } from './views/SystemView.js';
import { InspectorModal } from './components/InspectorModal.js';

export interface WorkspaceRouterProps {
  readonly activeTab: WorkspaceTab;
  readonly selectedIndex: number;
  readonly activeModal: ActiveModal | null;
  readonly closeModal: () => void;
  readonly positions: readonly BrokerPosition[];
  readonly timeline: readonly ActivityTimelineItem[];
  readonly focusSymbol: string;
  readonly opportunities: readonly ScanOpportunity[];
  readonly markets?: readonly MonitoredMarket[];
  readonly isScanning?: boolean;
  readonly pipelineSnapshots: PipelineSnapshots;
  readonly transcript: readonly TranscriptEntry[];
  readonly chat?: ReturnType<typeof useAgentChat>;
  readonly history?: PromptHistory;
}

const renderTab = (p: WorkspaceRouterProps): React.JSX.Element => {
  switch (p.activeTab) {
    case 'overview': return <OverviewView selectedIndex={p.selectedIndex} positions={p.positions} timeline={p.timeline} focusSymbol={p.focusSymbol} opportunities={p.opportunities} markets={p.markets} isScanning={p.isScanning} transcript={p.transcript} pipelineSnapshots={p.pipelineSnapshots} />;
    case 'agent': return <AgentView focusSymbol={p.focusSymbol} snapshots={p.pipelineSnapshots} transcript={p.transcript} selectedIndex={p.selectedIndex} chat={p.chat} history={p.history} />;
    case 'opps': return <OpportunitiesView selectedIndex={p.selectedIndex} opportunities={p.opportunities} markets={p.markets} isScanning={p.isScanning} />;
    case 'positions': return <PositionsView positions={p.positions} selectedIndex={p.selectedIndex} />;
    case 'orders': return <OrdersView selectedIndex={p.selectedIndex} />;
    case 'risk': return <RiskView />;
    case 'strategies': return <StrategiesView selectedIndex={p.selectedIndex} />;
    case 'learning': return <LearningView />;
    case 'events': return <EventsView timeline={p.timeline} selectedIndex={p.selectedIndex} />;
    case 'system': return <SystemView />;
    default: return <OverviewView selectedIndex={p.selectedIndex} positions={p.positions} timeline={p.timeline} focusSymbol={p.focusSymbol} opportunities={p.opportunities} markets={p.markets} isScanning={p.isScanning} transcript={p.transcript} pipelineSnapshots={p.pipelineSnapshots} />;
  }
};

export const WorkspaceRouter = (p: WorkspaceRouterProps): React.JSX.Element => {
  if (p.activeModal) return <InspectorModal modal={p.activeModal} onClose={p.closeModal} />;
  return (
    <Box flexDirection="column" minHeight={12} paddingY={0}>
      {renderTab(p)}
    </Box>
  );
};
