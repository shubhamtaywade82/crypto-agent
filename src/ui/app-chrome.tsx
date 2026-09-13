import React from 'react';
import { Box, Text } from 'ink';
import { TextInput } from '../components/ui/text-input/index.js';
import { binanceRateLimiter } from '../guardians/rate-limiter.js';
import { defaultModel } from '../config.js';
import { getKernel } from '../kernel.js';
import { deriveCircuitState, type CircuitState } from '../domain/risk/risk-config.js';
import type { PortfolioState } from '../domain/portfolio/portfolio-state.js';

const circuitColor = (c: CircuitState): string =>
  c === 'NORMAL' ? 'green' : c === 'CAUTION' ? 'yellow' : c === 'REDUCED' ? 'magenta' : 'red';

export const Header = ({ port, auto, mode }: {
  port: PortfolioState; auto: { enabled: boolean; interval: number }; mode: 'ops' | 'chat';
}): React.JSX.Element => {
  const kernel = getKernel();
  const ks = kernel.killSwitch.halted;
  const c = deriveCircuitState(port.dailyLossPercent, port.drawdownPercent, port.lossStreak, kernel.limits);
  const pnl = `${port.dailyRealizedPnl >= 0 ? '+' : ''}$${port.dailyRealizedPnl.toFixed(2)}`;
  return (
    <Box flexDirection="column">
      <Text bold color="cyan">🤖 Crypto Agent ({kernel.venue.toUpperCase()})</Text>
      <Text color="gray">
        {mode === 'ops' ? 'OPS' : 'CHAT'} │ Auto {auto.enabled ? 'ON' : 'OFF'} │ ${port.equity.toFixed(2)}
        │ Daily <Text color={port.dailyRealizedPnl >= 0 ? 'green' : 'red'}>{pnl}</Text>
        │ <Text color={ks ? 'red' : circuitColor(c)}>{ks ? 'HALTED' : c}</Text>
        │ {binanceRateLimiter.getCurrentWeight()}/1200 │ {defaultModel}
      </Text>
    </Box>
  );
};

export const PromptInput = (p: {
  readonly value: string;
  readonly busy: boolean;
  readonly onSubmit: () => void;
  readonly onChange: (v: string) => void;
  readonly onHistoryUp?: () => void;
  readonly onHistoryDown?: () => void;
}): React.JSX.Element => (
  <TextInput
    value={p.value}
    onChange={p.onChange}
    onSubmit={() => p.onSubmit()}
    focus={!p.busy}
    onUpArrow={p.onHistoryUp}
    onDownArrow={p.onHistoryDown}
  />
);
