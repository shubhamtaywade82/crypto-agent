import React from 'react';
import { Box, Text } from 'ink';
import { getKernel } from '../../kernel.js';
import type { OrderStatus } from '../../domain/orders/order-state.js';

export interface OrdersViewProps {
  readonly selectedIndex: number;
}

const FSM_STEPS: readonly OrderStatus[] = [
  'RISK_APPROVED',
  'SUBMITTING',
  'SUBMITTED',
  'ACKNOWLEDGED',
  'PARTIALLY_FILLED',
  'FILLED',
  'POSITION_OPEN',
];

const OrdersTable = (p: {
  readonly orders: readonly (ReturnType<typeof getKernel>['execution']['listOpen'] extends () => readonly (infer R)[] ? R : never)[];
  readonly safeIdx: number;
}): React.JSX.Element => (
  <Box flexDirection="column">
    <Text color="gray">   INTENT ID   PAIR         SIDE  QTY     EXPECTED   FILL PRICE  SLIPPAGE  STATUS</Text>
    {p.orders.map((o, idx) => {
      const isSel = idx === p.safeIdx;
      const isFill = o.status === 'FILLED' || o.status === 'POSITION_OPEN';
      const stColor = isFill ? 'green' : o.status === 'UNKNOWN' ? 'red' : 'yellow';
      const slip = o.expectedPrice && o.avgFillPrice
        ? ((o.avgFillPrice - o.expectedPrice) / o.expectedPrice * 10_000).toFixed(1) + ' bps'
        : '0.0 bps';
      return (
        <Text key={o.intentId} color={isSel ? 'black' : undefined} backgroundColor={isSel ? 'cyan' : undefined}>
          {isSel ? ' >' : '  '} {o.intentId.padEnd(11)} {o.pair.padEnd(12)} <Text color={isSel ? 'black' : o.side === 'buy' ? 'green' : 'red'}>{o.side.toUpperCase().padEnd(5)}</Text> {o.quantity.toFixed(3).padEnd(7)} {(o.expectedPrice ?? 0).toFixed(1).padEnd(10)} {(o.avgFillPrice ?? 0).toFixed(1).padEnd(11)} {slip.padEnd(9)} <Text color={isSel ? 'black' : stColor}>{o.status}</Text>
        </Text>
      );
    })}
  </Box>
);

const FsmLifecycle = ({ selected }: { readonly selected: { readonly intentId: string; readonly pair: string; readonly status: OrderStatus } }): React.JSX.Element => (
  <Box flexDirection="column">
    <Text color="gray">{'─'.repeat(Math.max(20, (process.stdout.columns || 80) - 6))}</Text>
    <Text bold color="yellow">FSM LIFECYCLE: {selected.intentId} ({selected.pair})</Text>
    <Box flexDirection="column" marginY={0}>
      {FSM_STEPS.map((step, idx) => {
        const isReached = FSM_STEPS.indexOf(selected.status) >= idx;
        const isCurrent = selected.status === step;
        return (
          <Box key={step} flexDirection="column">
            <Text color={isCurrent ? 'green' : isReached ? 'white' : 'gray'}>
              {'  '}{isCurrent ? '●' : isReached ? '✓' : '○'} <Text bold={isCurrent}>{step}</Text>
              {isCurrent ? <Text color="green"> (CURRENT)</Text> : null}
            </Text>
            {idx < FSM_STEPS.length - 1 && <Text color="gray">{'    │'}</Text>}
          </Box>
        );
      })}
    </Box>
  </Box>
);

export const OrdersView = ({ selectedIndex }: OrdersViewProps): React.JSX.Element => {
  const k = getKernel();
  const openOrders = k.execution.listOpen();
  const sampleOrders = openOrders.length > 0 ? openOrders : [
    {
      intentId: 'd_91fa2', pair: 'B-BTC_USDT', symbol: 'BTCUSDT', side: 'buy' as const,
      quantity: 0.010, reduceOnly: false, status: 'POSITION_OPEN' as OrderStatus,
      filledQuantity: 0.010, avgFillPrice: 112450.5, updatedAt: Date.now() - 120_000,
      registeredAt: Date.now() - 120_200, intentType: 'ENTRY' as const,
      expectedPrice: 112450.0, maxSlippageBps: 25,
    },
  ];

  const safeIdx = Math.min(selectedIndex, sampleOrders.length - 1);
  const selected = sampleOrders[safeIdx] ?? sampleOrders[0]!;

  return (
    <Box flexDirection="column" gap={1} paddingX={1}>
      <Text bold color="cyan">ORDER EXECUTION &amp; RECONCILIATION FSM</Text>
      <OrdersTable orders={sampleOrders} safeIdx={safeIdx} />
      <FsmLifecycle selected={selected} />
    </Box>
  );
};
