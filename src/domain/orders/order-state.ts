/** Full order lifecycle states — including the critical UNKNOWN state. */
export type OrderStatus =
  | 'ORDER_INTENT'
  | 'RISK_APPROVED'
  | 'SUBMITTING'
  | 'SUBMITTED'
  | 'ACKNOWLEDGED'
  | 'PARTIALLY_FILLED'
  | 'FILLED'
  | 'POSITION_OPEN'
  | 'PROTECTED'
  | 'EXIT_REQUESTED'
  | 'CLOSED'
  | 'REJECTED'
  | 'CANCELLED'
  | 'EXPIRED'
  | 'UNKNOWN';

const ALLOWED: Readonly<Record<OrderStatus, readonly OrderStatus[]>> = {
  ORDER_INTENT: ['RISK_APPROVED', 'REJECTED'],
  RISK_APPROVED: ['SUBMITTING', 'CANCELLED', 'EXPIRED'],
  SUBMITTING: ['SUBMITTED', 'UNKNOWN', 'REJECTED', 'FILLED', 'PARTIALLY_FILLED'],
  SUBMITTED: ['ACKNOWLEDGED', 'PARTIALLY_FILLED', 'FILLED', 'UNKNOWN', 'CANCELLED', 'EXPIRED', 'REJECTED'],
  ACKNOWLEDGED: ['PARTIALLY_FILLED', 'FILLED', 'UNKNOWN', 'CANCELLED', 'EXPIRED'],
  PARTIALLY_FILLED: ['PARTIALLY_FILLED', 'FILLED', 'UNKNOWN', 'CANCELLED', 'EXPIRED'],
  FILLED: ['POSITION_OPEN', 'CLOSED'],
  POSITION_OPEN: ['PROTECTED', 'EXIT_REQUESTED', 'CLOSED', 'UNKNOWN'],
  PROTECTED: ['EXIT_REQUESTED', 'CLOSED', 'UNKNOWN'],
  EXIT_REQUESTED: ['SUBMITTING', 'CLOSED', 'UNKNOWN', 'REJECTED'],
  CLOSED: [],
  REJECTED: [],
  CANCELLED: [],
  EXPIRED: [],
  UNKNOWN: ['SUBMITTED', 'ACKNOWLEDGED', 'PARTIALLY_FILLED', 'FILLED', 'CANCELLED', 'CLOSED'],
};

export const canTransition = (from: OrderStatus, to: OrderStatus): boolean =>
  ALLOWED[from]?.includes(to) ?? false;

export const isTerminal = (status: OrderStatus): boolean =>
  ALLOWED[status].length === 0;

export const isFailure = (status: OrderStatus): boolean =>
  status === 'REJECTED' || status === 'CANCELLED' || status === 'EXPIRED' || status === 'UNKNOWN';

/** Throw-on-invalid transition — used by the ExecutionEngine runtime. */
export const assertTransition = (from: OrderStatus, to: OrderStatus): void => {
  if (!canTransition(from, to)) {
    throw new Error(`Illegal order state transition: ${from} -> ${to}`);
  }
};

export const OPEN_POSITION_STATES: readonly OrderStatus[] = [
  'FILLED', 'POSITION_OPEN', 'PROTECTED', 'EXIT_REQUESTED',
];
