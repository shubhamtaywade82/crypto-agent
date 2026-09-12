import React from 'react';
import { Box, Text } from 'ink';
import { Divider } from '../../components/ui/divider/index.js';
import { ProgressBar } from '../../components/ui/progress-bar/index.js';
import { Badge } from '../../components/ui/badge/index.js';
import { getKernel } from '../../kernel.js';
import { deriveCircuitState, circuitRiskMultiplier } from '../../domain/risk/risk-config.js';

interface RiskControl {
  readonly name: string;
  readonly cur: string;
  readonly lim: string;
  readonly status: string;
}

const safeRatio = (val: number, max: number): number =>
  Math.max(0, Math.min(100, max > 0 ? (val / max) * 100 : 0));

const CapitalEnvelope = (p: {
  readonly dailyRealizedPnl: number;
  readonly usedMargin: number;
  readonly equity: number;
  readonly lossStreak: number;
  readonly maxDailyLossPercent: number;
  readonly maxLossStreak: number;
}): React.JSX.Element => {
  const riskBudgetMax = p.equity * (p.maxDailyLossPercent / 100);
  const riskBudgetUsed = p.dailyRealizedPnl < 0 ? Math.abs(p.dailyRealizedPnl) : 0;
  return (
    <Box flexDirection="column" gap={0}>
      <Divider style="single" />
      <Text bold color="yellow">CAPITAL ENVELOPE</Text>
      <Box gap={1} alignItems="center">
        <Text color="gray">Risk budget:  </Text>
        <ProgressBar value={safeRatio(riskBudgetUsed, riskBudgetMax)} width={14} showPercent />
      </Box>
      <Box gap={1} alignItems="center">
        <Text color="gray">Margin usage: </Text>
        <ProgressBar value={safeRatio(p.usedMargin, p.equity)} width={14} showPercent />
      </Box>
      <Text color="gray">
        Loss streak:   {p.lossStreak} / {p.maxLossStreak} trades
      </Text>
    </Box>
  );
};

const buildControls = (port: ReturnType<typeof getKernel>['portfolio']['peek'] extends () => infer R ? R : never, limits: ReturnType<typeof getKernel>['limits'], multiplier: number): readonly RiskControl[] => [
  { name: 'Risk per trade', cur: `${(limits.maxRiskPerTradePercent * multiplier).toFixed(2)}%`, lim: `${limits.maxRiskPerTradePercent.toFixed(2)}%`, status: 'PASS' },
  { name: 'Daily loss', cur: `${port.dailyLossPercent.toFixed(2)}%`, lim: `${limits.maxDailyLossPercent.toFixed(2)}%`, status: port.dailyLossPercent <= limits.maxDailyLossPercent ? 'PASS' : 'BREACH' },
  { name: 'Max Drawdown', cur: `${port.drawdownPercent.toFixed(2)}%`, lim: `${limits.maxDrawdownPercent.toFixed(2)}%`, status: port.drawdownPercent <= limits.maxDrawdownPercent ? 'PASS' : 'BREACH' },
  { name: 'Open positions', cur: `${port.openPositions}`, lim: `${limits.maxConcurrentPositions}`, status: port.openPositions <= limits.maxConcurrentPositions ? 'PASS' : 'BREACH' },
  { name: 'Gross exposure', cur: `${port.grossExposure.toFixed(0)} USDT`, lim: `${limits.maxPortfolioGrossExposurePercent}%`, status: 'PASS' },
  { name: 'Max leverage', cur: '2x', lim: `${limits.maxLeverage}x`, status: 'PASS' },
];

export const RiskView = (): React.JSX.Element => {
  const k = getKernel();
  const port = k.portfolio.peek();
  const circuit = deriveCircuitState(port.dailyLossPercent, port.drawdownPercent, port.lossStreak, k.limits);
  const multiplier = circuitRiskMultiplier(circuit);
  const controls = buildControls(port, k.limits, multiplier);

  return (
    <Box flexDirection="column" gap={1} paddingX={1}>
      <Box justifyContent="space-between" alignItems="center">
        <Text bold color="cyan">RISK GOVERNOR &amp; CIRCUIT BREAKERS</Text>
        <Badge variant={k.killSwitch.halted ? 'error' : circuit === 'NORMAL' ? 'success' : 'warning'}>
          {`CIRCUIT: ${k.killSwitch.halted ? 'HALTED' : circuit} (x${multiplier.toFixed(2)})`}
        </Badge>
      </Box>
      <Box flexDirection="column">
        <Text color="gray">CONTROL                   CURRENT       LIMIT         STATUS</Text>
        {controls.map((c) => (
          <Box key={c.name} gap={1} alignItems="center">
            <Text>{c.name.padEnd(25)} {c.cur.padEnd(13)} {c.lim.padEnd(13)} </Text>
            <Badge variant={c.status === 'PASS' ? 'success' : 'error'}>{c.status}</Badge>
          </Box>
        ))}
      </Box>
      <CapitalEnvelope
        dailyRealizedPnl={port.dailyRealizedPnl} usedMargin={port.usedMargin}
        equity={port.equity} lossStreak={port.lossStreak}
        maxDailyLossPercent={k.limits.maxDailyLossPercent} maxLossStreak={k.limits.maxLossStreak}
      />
    </Box>
  );
};

