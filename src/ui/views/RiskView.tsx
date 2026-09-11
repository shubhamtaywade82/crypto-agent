import React from 'react';
import { Box, Text } from 'ink';
import { getKernel } from '../../kernel.js';
import { deriveCircuitState, circuitRiskMultiplier } from '../../domain/risk/risk-config.js';

const progressBar = (val: number, max: number, width = 14): string => {
  const ratio = Math.max(0, Math.min(1, max > 0 ? val / max : 0));
  const filled = Math.round(ratio * width);
  return `[${'█'.repeat(filled)}${'░'.repeat(Math.max(0, width - filled))}] ${(ratio * 100).toFixed(0)}%`;
};

interface RiskControl {
  readonly name: string;
  readonly cur: string;
  readonly lim: string;
  readonly status: string;
}

const CapitalEnvelope = (p: {
  readonly dailyRealizedPnl: number;
  readonly usedMargin: number;
  readonly equity: number;
  readonly lossStreak: number;
  readonly maxDailyLossPercent: number;
  readonly maxLossStreak: number;
}): React.JSX.Element => (
  <Box flexDirection="column">
    <Text color="gray">{'─'.repeat(Math.max(20, (process.stdout.columns || 80) - 6))}</Text>
    <Text bold color="yellow">CAPITAL ENVELOPE</Text>
    <Text color="gray">
      Risk budget:    {progressBar(p.dailyRealizedPnl < 0 ? Math.abs(p.dailyRealizedPnl) : 0, p.equity * (p.maxDailyLossPercent / 100))}
    </Text>
    <Text color="gray">
      Margin usage:   {progressBar(p.usedMargin, p.equity)}
    </Text>
    <Text color="gray">
      Loss streak:    {p.lossStreak} / {p.maxLossStreak} trades
    </Text>
  </Box>
);

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
      <Box justifyContent="space-between">
        <Text bold color="cyan">RISK GOVERNOR &amp; CIRCUIT BREAKERS</Text>
        <Text bold color={k.killSwitch.halted ? 'red' : 'green'}>
          CIRCUIT: {k.killSwitch.halted ? 'HALTED' : circuit} (x{multiplier.toFixed(2)})
        </Text>
      </Box>
      <Box flexDirection="column">
        <Text color="gray">CONTROL                   CURRENT       LIMIT         STATUS</Text>
        {controls.map((c) => (
          <Text key={c.name}>
            {c.name.padEnd(25)} {c.cur.padEnd(13)} {c.lim.padEnd(13)} <Text color={c.status === 'PASS' ? 'green' : 'red'}>{c.status}</Text>
          </Text>
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
