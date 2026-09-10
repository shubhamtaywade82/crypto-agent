import React from 'react';
import { Box, Text, useApp, useInput } from 'ink';
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
  value: string; busy: boolean; onSubmit: () => void; onChange: (v: string) => void;
  onHistoryUp?: () => void; onHistoryDown?: () => void;
}): React.JSX.Element => {
  const { exit } = useApp();
  useInput((input, key) => {
    if (key.ctrl && (input === 'c' || input === '\u0003')) exit();
    else if (!p.busy && key.upArrow) p.onHistoryUp?.();
    else if (!p.busy && key.downArrow) p.onHistoryDown?.();
    else if (!p.busy && key.return) p.onSubmit();
    else if (!p.busy && (key.backspace || key.delete)) p.onChange(p.value.slice(0, -1));
    else if (!p.busy && !key.ctrl && !key.meta && input) p.onChange(p.value + input);
  });
  return <Box><Text bold color={p.busy ? 'gray' : 'green'}>&gt; </Text><Text>{p.value}</Text>{!p.busy && <Text color="green">█</Text>}</Box>;
};
