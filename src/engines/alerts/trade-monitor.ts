import type { AlertEvent } from '../../domain/alerts/types.js';
import type { KernelEvent } from '../../infrastructure/events/event-store.js';
import { makeAlert } from './make-alert.js';
import type { AlertDispatcher } from './dispatcher.js';

const rec = (payload: unknown): Record<string, unknown> =>
  payload !== null && typeof payload === 'object' ? payload as Record<string, unknown> : {};

const str = (v: unknown): string | undefined => typeof v === 'string' ? v : undefined;
const num = (v: unknown): number | undefined => typeof v === 'number' && Number.isFinite(v) ? v : undefined;

const TRADE_TYPES = new Set([
  'fill.recorded', 'position.opened', 'position.closed', 'order.transition',
]);

const fillAlert = (event: KernelEvent, p: Record<string, unknown>, symbol?: string): AlertEvent =>
  makeAlert({
    at: event.at, class: 'TRADE', severity: 'SIGNAL', symbol,
    title: 'TRADE EXECUTED',
    body: [
      `${symbol ?? ''} ${str(p.side) ?? ''}`.trim(),
      `Entry: ${num(p.price) ?? '—'}`,
      `Size: ${num(p.quantity) ?? '—'}`,
      `Intent: ${str(p.intentType) ?? '—'}`,
    ].join('\n'),
    fingerprint: `TRADE:${event.decisionId ?? event.at}:fill`,
    stateTo: str(p.intentType) ?? 'FILL',
    payload: p,
  });

const closeAlert = (event: KernelEvent, p: Record<string, unknown>, symbol?: string): AlertEvent => {
  const pnl = num(p.pnl) ?? num(p.realizedPnl);
  const r = num(p.rMultiple);
  return makeAlert({
    at: event.at, class: 'TRADE', severity: 'SIGNAL', symbol,
    title: 'TRADE CLOSED',
    body: [`${symbol ?? ''} closed`, pnl !== undefined ? `PnL: ${pnl}` : '', r !== undefined ? `Result: ${r.toFixed(2)}R` : '']
      .filter(Boolean).join('\n'),
    fingerprint: `TRADE:${str(p.positionId) ?? event.at}:close`,
    stateTo: 'CLOSED',
    payload: p,
  });
};

export const tradeAlertFromEvent = (event: KernelEvent): AlertEvent | undefined => {
  const p = rec(event.payload);
  const symbol = event.symbol ?? str(p.symbol);
  if (event.type === 'fill.recorded') return fillAlert(event, p, symbol);
  if (event.type === 'position.opened') {
    return makeAlert({
      at: event.at, class: 'TRADE', severity: 'SIGNAL', symbol,
      title: 'POSITION OPEN', body: `${symbol ?? ''} opened`,
      fingerprint: `TRADE:${str(p.positionId) ?? event.at}:open`,
      stateTo: 'OPEN', payload: p,
    });
  }
  if (event.type === 'position.closed') return closeAlert(event, p, symbol);
  if (event.type !== 'order.transition') return undefined;
  const to = str(p.to) ?? str(p.status);
  if (to !== 'FILLED' && to !== 'CANCELLED' && to !== 'REJECTED') return undefined;
  return makeAlert({
    at: event.at, class: 'TRADE', severity: to === 'FILLED' ? 'SIGNAL' : 'IMPORTANT', symbol,
    title: `ORDER ${to}`,
    body: `${symbol ?? ''} ${str(p.from) ?? ''} → ${to}`,
    fingerprint: `TRADE:${event.decisionId ?? event.at}:${to}`,
    stateFrom: str(p.from), stateTo: to, payload: p,
  });
};

export class TradeMonitor {
  constructor(private readonly dispatcher: AlertDispatcher) {}

  async onKernelEvent(event: KernelEvent): Promise<void> {
    if (!TRADE_TYPES.has(event.type)) return;
    const alert = tradeAlertFromEvent(event);
    if (alert) await this.dispatcher.publish(alert);
  }
}
