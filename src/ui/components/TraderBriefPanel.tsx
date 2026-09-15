import React from 'react';
import { Box, Text } from 'ink';
import { Badge, type BadgeVariant } from '../../components/ui/badge/index.js';
import type { TraderBrief, TraderStance } from '../overview-brief.js';

import { fmtPrice } from '../KernelDashboard.js';

const stanceVariant = (s: TraderStance): BadgeVariant => {
  if (s === 'LONG') return 'success';
  if (s === 'SHORT') return 'error';
  if (s === 'AVOID') return 'error';
  if (s === 'WAIT') return 'warning';
  return 'info';
};

const LevelsRow = ({ levels, symbol }: {
  readonly levels: TraderBrief['levels'];
  readonly symbol: string;
}): React.JSX.Element | null => {
  const parts: string[] = [];
  if (levels.support !== undefined) parts.push(`S $${fmtPrice(levels.support, symbol)}`);
  if (levels.resistance !== undefined) parts.push(`R $${fmtPrice(levels.resistance, symbol)}`);
  if (levels.entry !== undefined) parts.push(`E $${fmtPrice(levels.entry, symbol)}`);
  if (levels.stop !== undefined) parts.push(`SL $${fmtPrice(levels.stop, symbol)}`);
  if (levels.target !== undefined) parts.push(`TP $${fmtPrice(levels.target, symbol)}`);
  if (levels.rr !== undefined) parts.push(`RR ${levels.rr.toFixed(2)}`);
  if (parts.length === 0) return null;
  return <Text color="gray" wrap="truncate">  Levels: <Text color="white">{parts.join(' │ ')}</Text></Text>;
};

const regimeVariant = (regime: string): BadgeVariant => {
  if (regime.includes('UP') || regime.includes('BULL')) return 'success';
  if (regime.includes('DOWN') || regime.includes('BEAR') || regime === 'PANIC') return 'error';
  return 'default';
};

const BriefRegimeRow = ({ brief, conf }: { readonly brief: TraderBrief; readonly conf: string }): React.JSX.Element => (
  <Text wrap="truncate">
    <Text color="gray">Regime </Text>
    <Badge variant={regimeVariant(brief.regime)}>{brief.regime}</Badge>
    <Text color="gray"> │ MTF <Text color="white">{brief.mtf}</Text>
      {brief.setup ? <> │ Setup <Text color="yellow">{brief.setup}</Text></> : null}
      {' │ '}Conf <Text color="white">{conf}</Text>
    </Text>
  </Text>
);

const BriefNotes = ({ brief }: { readonly brief: TraderBrief }): React.JSX.Element => (
  <>
    {brief.thesis ? <Text color="gray" wrap="truncate">  Thesis: <Text color="white">"{brief.thesis.slice(0, 120)}{brief.thesis.length > 120 ? '…' : ''}"</Text></Text> : null}
    {brief.trigger ? <Text color="gray" wrap="truncate">  Trigger: <Text color="green">{brief.trigger}</Text></Text> : null}
    {brief.invalidation ? <Text color="gray" wrap="truncate">  Invalidate: <Text color="red">{brief.invalidation}</Text></Text> : null}
    <LevelsRow levels={brief.levels} symbol={brief.symbol} />
    <Text color="gray" wrap="truncate">  Risk: <Text color={brief.riskOk ? 'green' : 'red'}>{brief.riskNote}</Text></Text>
    {brief.microNote ? <Text color="yellow" wrap="truncate">  ⚠ {brief.microNote}</Text> : null}
    {brief.alternate ? (
      <Text color="gray" wrap="truncate">
        Alt watch: <Text color="cyan">{brief.alternate.symbol}</Text> {brief.alternate.direction} {brief.alternate.setup} ({brief.alternate.state}, conf {(brief.alternate.confidence * 100).toFixed(0)}%)
      </Text>
    ) : null}
  </>
);

export const TraderBriefPanel = ({ brief }: { readonly brief: TraderBrief }): React.JSX.Element => {
  const conf = brief.confidence !== null ? `${(brief.confidence * 100).toFixed(0)}%` : '—';
  const scanLabel = brief.pipelineAge
    ? `Market Data: LIVE · Last scan: ${brief.pipelineAge}`
    : 'Market Data: LIVE';

  return (
    <Box flexDirection="column" gap={0} flexShrink={0}>
      <Box justifyContent="space-between" flexWrap="nowrap" overflow="hidden">
        <Text wrap="truncate" bold color="cyan">TRADER BRIEF — {brief.symbol}</Text>
        <Box flexShrink={0}>
          {brief.dataFresh ? (
            <Text color="gray"><Text color="green">●</Text> {scanLabel}</Text>
          ) : (
            <Badge variant="error">STALE</Badge>
          )}
        </Box>
      </Box>
      <Text wrap="truncate">
        <Badge variant={stanceVariant(brief.stance)}>{brief.stance}</Badge>
        <Text color="white"> {brief.headline}</Text>
      </Text>
      <BriefRegimeRow brief={brief} conf={conf} />
      <BriefNotes brief={brief} />
    </Box>
  );
};
