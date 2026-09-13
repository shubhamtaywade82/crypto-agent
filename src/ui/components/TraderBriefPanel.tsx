import React from 'react';
import { Box, Text } from 'ink';
import { Badge, type BadgeVariant } from '../../components/ui/badge/index.js';
import { Spinner } from '../../components/ui/spinner/index.js';
import type { TraderBrief, TraderStance } from '../overview-brief.js';

const stanceVariant = (s: TraderStance): BadgeVariant => {
  if (s === 'LONG') return 'success';
  if (s === 'SHORT') return 'error';
  if (s === 'AVOID') return 'error';
  if (s === 'WAIT') return 'warning';
  return 'info';
};

const LevelsRow = ({ levels }: { readonly levels: TraderBrief['levels'] }): React.JSX.Element | null => {
  const parts: string[] = [];
  if (levels.support !== undefined) parts.push(`S $${levels.support.toFixed(0)}`);
  if (levels.resistance !== undefined) parts.push(`R $${levels.resistance.toFixed(0)}`);
  if (levels.entry !== undefined) parts.push(`E $${levels.entry.toFixed(2)}`);
  if (levels.stop !== undefined) parts.push(`SL $${levels.stop.toFixed(2)}`);
  if (levels.target !== undefined) parts.push(`TP $${levels.target.toFixed(2)}`);
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
  <Box gap={1} alignItems="center">
    <Text color="gray">Regime</Text>
    <Badge variant={regimeVariant(brief.regime)}>{brief.regime}</Badge>
    <Text color="gray">│ MTF <Text color="white">{brief.mtf}</Text>
      {brief.setup ? <> │ Setup <Text color="yellow">{brief.setup}</Text></> : null}
      {' │ '}Conf <Text color="white">{conf}</Text>
    </Text>
  </Box>
);

const BriefNotes = ({ brief }: { readonly brief: TraderBrief }): React.JSX.Element => (
  <>
    {brief.thesis ? <Text color="gray" wrap="truncate">  Thesis: <Text color="white">"{brief.thesis.slice(0, 120)}{brief.thesis.length > 120 ? '…' : ''}"</Text></Text> : null}
    {brief.trigger ? <Text color="gray" wrap="truncate">  Trigger: <Text color="green">{brief.trigger}</Text></Text> : null}
    {brief.invalidation ? <Text color="gray" wrap="truncate">  Invalidate: <Text color="red">{brief.invalidation}</Text></Text> : null}
    <LevelsRow levels={brief.levels} />
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
    <Box flexDirection="column" gap={0}>
      <Box justifyContent="space-between">
        <Text bold color="cyan">TRADER BRIEF — {brief.symbol}</Text>
        {brief.dataFresh
          ? <Spinner type="dots" label={scanLabel} />
          : <Badge variant="error">STALE</Badge>}
      </Box>
      <Box gap={1} alignItems="center">
        <Badge variant={stanceVariant(brief.stance)}>{brief.stance}</Badge>
        <Text color="white" wrap="truncate">{brief.headline}</Text>
      </Box>
      <BriefRegimeRow brief={brief} conf={conf} />
      <BriefNotes brief={brief} />
    </Box>
  );
};
