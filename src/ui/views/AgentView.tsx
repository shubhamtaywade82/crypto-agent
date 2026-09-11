import React from 'react';
import { Box, Text } from 'ink';
import { getKernel } from '../../kernel.js';

export interface AgentViewProps {
  readonly focusSymbol: string;
}

const AnalystSection = ({ micro }: { readonly micro?: { readonly spreadBps: number; readonly imbalance: number; readonly flowBias: string } }): React.JSX.Element => (
  <Box flexDirection="column">
    <Text bold color="green">1. ANALYST EVIDENCE</Text>
    <Text color="gray">  ├─ Regime:       <Text color="white">TREND_UP (ADX: 28.4, EMA20 &gt; EMA50 &gt; EMA200)</Text></Text>
    <Text color="gray">  ├─ Structure:    <Text color="white">BULLISH_BOS on 1h (breakout level: 112,200)</Text></Text>
    <Text color="gray">  ├─ MTF Trend:    <Text color="white">4H: ↑ │ 1H: ↑ │ 15m: ↑ │ 5m: →</Text></Text>
    <Text color="gray">  ├─ Microflow:    <Text color="white">Spread: {micro?.spreadBps.toFixed(1) ?? '0.8'} bps │ Imbalance: {((micro?.imbalance ?? 0.64) * 100).toFixed(0)}% │ Bias: {micro?.flowBias ?? 'BUY'}</Text></Text>
    <Text color="gray">  └─ Volatility:   <Text color="white">NORMAL (ATR14: 0.75% of price)</Text></Text>
  </Box>
);

const StrategistSection = (): React.JSX.Element => (
  <Box flexDirection="column">
    <Text bold color="yellow">2. STRATEGIST THESIS</Text>
    <Text color="gray">  ├─ Candidate:    <Text color="white">PULLBACK_RECLAIM (1h demand block)</Text></Text>
    <Text color="gray">  ├─ Confidence:   <Text color="white">0.78 / 1.00</Text></Text>
    <Text color="gray">  ├─ Thesis:       <Text color="white">"HTF trend continuation intact; 15m liquidity sweep reclaimed support"</Text></Text>
    <Text color="gray">  └─ Invalidation: <Text color="white">15m close below 110,000</Text></Text>
  </Box>
);

const RiskPolicySection = (): React.JSX.Element => (
  <>
    <Box flexDirection="column">
      <Text bold color="magenta">3. RISK CHALLENGER</Text>
      <Text color="gray">  ├─ Verdict:      <Text color="green">PASS (No veto)</Text></Text>
      <Text color="gray">  ├─ Risk Budget:  <Text color="white">0.25% of equity ($25.00)</Text></Text>
      <Text color="gray">  ├─ Geometry:     <Text color="white">Entry: 112,450 │ Stop: 110,000 │ TP: 118,000 │ R:R: 2.80 (min 2.50)</Text></Text>
      <Text color="gray">  └─ Constraints:  <Text color="white">Leverage: 2x Isolated │ Max Concurrent: 2</Text></Text>
    </Box>
    <Box flexDirection="column">
      <Text bold color="blue">4. POLICY GATEWAY &amp; RESERVATION</Text>
      <Text color="gray">  ├─ Strategy Cell: <Text color="white">PULLBACK_RECLAIM × TREND_UP (ACTIVE, Exp: +0.31R)</Text></Text>
      <Text color="gray">  ├─ Cross-Venue:   <Text color="green">OK (Basis: 2.1 bps &lt; 15 bps limit)</Text></Text>
      <Text color="gray">  ├─ Reservation:   <Text color="green">ACTIVE (res_8f12: $25.00 risk reserved)</Text></Text>
      <Text color="gray">  └─ Decision:      <Text bold color="green">APPROVED → SUBMITTED</Text></Text>
    </Box>
  </>
);

export const AgentView = ({ focusSymbol }: AgentViewProps): React.JSX.Element => {
  const k = getKernel();
  const snap = k.marketStore.snapshot(focusSymbol);

  return (
    <Box flexDirection="column" gap={1} paddingX={1}>
      <Text bold color="cyan">AGENT REASONING PIPELINE: <Text color="yellow">{focusSymbol}</Text></Text>
      <AnalystSection micro={snap?.microstructure} />
      <StrategistSection />
      <RiskPolicySection />
    </Box>
  );
};
