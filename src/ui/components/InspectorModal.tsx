import React from 'react';
import { Box, Text } from 'ink';
import type { ActiveModal } from '../types.js';

export interface InspectorModalProps {
  readonly modal: ActiveModal;
  readonly onClose: () => void;
}

const DecisionTraceView = (): React.JSX.Element => (
  <Box flexDirection="column" gap={0}>
    <Text bold color="cyan">DECISION TRACE: d_91fa2 (BTCUSDT LONG)</Text>
    <Text color="gray">MARKET → CANDIDATE → STRATEGY → RISK → POLICY → RESERVATION → EXECUTION → FILL → POSITION</Text>
    <Text color="green">  ✓          ✓          ✓        ✓       ✓          ✓            ✓         ✓        ✓   </Text>
    <Text color="gray">{'─'.repeat(74)}</Text>
    <Text color="gray">11:54:00 [MARKET EVENT]  BTCUSDT 5m close + OI spike (+4.2%)</Text>
    <Text color="gray">11:54:01 [STATE]         Regime: TREND_UP │ Microflow: BUY │ Imbalance: +64%</Text>
    <Text color="gray">11:54:02 [CANDIDATE]     Pullback Reclaim on 15m/1h support block (Conf: 0.78)</Text>
    <Text color="gray">11:54:03 [STRATEGIST]    Thesis: Bullish trend continuation, stop: 110,000, TP: 118,000</Text>
    <Text color="gray">11:54:04 [RISK ENGINE]   PASS │ Budget: $25.00 (0.25%) │ RR: 2.80 │ Leverage: 2x</Text>
    <Text color="gray">11:54:05 [POLICY]        APPROVED │ Cell active: PULLBACK_RECLAIM × TREND_UP</Text>
    <Text color="gray">11:54:05 [RESERVATION]   res_8f12 reserved $25.00 risk + $562.25 margin</Text>
    <Text color="gray">11:54:06 [EXECUTION]     IOC order submitted to venue</Text>
    <Text color="gray">11:54:07 [FILL]          100% filled @ 112,450.00 (Slippage: +0.4 bps)</Text>
    <Text color="gray">11:54:08 [POSITION]      BTCUSDT LONG open and protected by trailing stop</Text>
  </Box>
);

const HelpView = (): React.JSX.Element => (
  <Box flexDirection="column" gap={0}>
    <Text bold color="yellow">TERMINAL OPERATIONS CONSOLE - KEYBOARD SHORTCUTS</Text>
    <Text color="gray">{'─'.repeat(70)}</Text>
    <Text color="white">1 - 0            <Text color="gray">Direct workspace tab jump (1 Overview .. 0 System)</Text></Text>
    <Text color="white">Tab / Shift+Tab  <Text color="gray">Cycle through workspace tabs</Text></Text>
    <Text color="white">j / k or ↓ / ↑   <Text color="gray">Navigate items in lists / tables</Text></Text>
    <Text color="white">Enter            <Text color="gray">Inspect selected item / submit prompt in chat</Text></Text>
    <Text color="white">Esc              <Text color="gray">Dismiss inspection modal / clear input</Text></Text>
    <Text color="white">p                <Text color="gray">Toggle autonomous scanning daemon (pause/resume)</Text></Text>
    <Text color="white">k                <Text color="gray">Trip emergency kill switch (halt trading)</Text></Text>
    <Text color="white">q                <Text color="gray">Quit console application</Text></Text>
    <Text color="gray">{'─'.repeat(70)}</Text>
    <Text bold color="yellow">COMMANDS: <Text color="white">/scan  /focus &lt;SYM&gt;  /pipeline &lt;SYM&gt;  /halt  /resume  /clear</Text></Text>
  </Box>
);

export const InspectorModal = ({ modal }: InspectorModalProps): React.JSX.Element => (
  <Box
    flexDirection="column"
    borderStyle="double"
    borderColor="cyan"
    paddingX={2}
    paddingY={1}
    marginY={0}
  >
    {modal.type === 'decision_trace' ? <DecisionTraceView /> : <HelpView />}
    <Box marginTop={1} justifyContent="flex-end">
      <Text color="cyan">[Esc] Close</Text>
    </Box>
  </Box>
);
