import React, { useEffect, useState } from 'react';
import { Box, Text } from 'ink';
import { Divider } from '../../components/ui/divider/index.js';
import { Stepper, type Step } from '../../components/ui/stepper/index.js';
import { Badge } from '../../components/ui/badge/index.js';
import { getKernel } from '../../kernel.js';
import type { OrderStatus } from '../../domain/orders/order-state.js';
import type { TrackedOrder } from '../../engines/execution-engine.js';

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

const STEPS: readonly Step[] = FSM_STEPS.map((s) => ({ key: s, title: s }));

const OrdersTable = (p: {
  readonly orders: readonly TrackedOrder[];
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

const FsmLifecycle = ({ selected }: { readonly selected: TrackedOrder }): React.JSX.Element => {
  const curIdx = FSM_STEPS.indexOf(selected.status);
  const completed = curIdx >= 0 ? FSM_STEPS.slice(0, curIdx) : [];
  const isFilled = selected.status === 'FILLED' || selected.status === 'POSITION_OPEN';
  const badgeVariant = isFilled ? 'success' : selected.status === 'UNKNOWN' ? 'error' : 'warning';
  return (
    <Box flexDirection="column">
      <Divider style="single" />
      <Box justifyContent="space-between" alignItems="center" marginBottom={1}>
        <Text bold color="yellow">FSM LIFECYCLE: {selected.intentId} ({selected.pair})</Text>
        <Badge variant={badgeVariant}>{selected.status}</Badge>
      </Box>
      <Stepper
        steps={[...STEPS]}
        currentStep={selected.status}
        completedSteps={[...completed]}
        orientation="vertical"
      />
    </Box>
  );
};

const useOpenOrders = (): readonly TrackedOrder[] => {
  const [orders, setOrders] = useState<readonly TrackedOrder[]>([]);
  useEffect(() => {
    const poll = (): void => setOrders(getKernel().execution.listOpen());
    poll();
    const t = setInterval(poll, 1500);
    return (): void => clearInterval(t);
  }, []);
  return orders;
};

export const OrdersView = ({ selectedIndex }: OrdersViewProps): React.JSX.Element => {
  const openOrders = useOpenOrders();
  const safeIdx = openOrders.length > 0 ? Math.min(selectedIndex, openOrders.length - 1) : 0;
  const selected = openOrders[safeIdx];

  return (
    <Box flexDirection="column" gap={1}>
      <Text bold color="cyan">ORDER EXECUTION &amp; RECONCILIATION FSM</Text>
      {openOrders.length === 0 ? (
        <Text color="gray" italic>No open order intents — kernel is idle or all fills reconciled.</Text>
      ) : (
        <>
          <OrdersTable orders={openOrders} safeIdx={safeIdx} />
          {selected ? <FsmLifecycle selected={selected} /> : null}
        </>
      )}
    </Box>
  );
};
