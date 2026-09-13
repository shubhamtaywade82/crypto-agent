import type { EventStore } from '../../infrastructure/events/event-store.js';
import type { AlertDecision, AlertEvent } from '../../domain/alerts/types.js';
import { NotificationEngine } from './notification-engine.js';
import { emitAlert } from './alert-bus.js';
import { sendAlertTelegram } from '../../notifications/alert-telegram.js';
import type { AlertSubscriptions } from './subscriptions.js';

export class AlertDispatcher {
  readonly engine: NotificationEngine;

  constructor(
    private readonly store: EventStore,
    subscriptions?: AlertSubscriptions
  ) {
    this.engine = new NotificationEngine(subscriptions);
  }

  async publish(event: AlertEvent): Promise<AlertDecision> {
    const decision = this.engine.submit(event);
    this.store.append({
      type: decision.action === 'emitted' ? 'alert.emitted' : 'alert.suppressed',
      symbol: event.symbol,
      payload: {
        id: event.id, class: event.class, severity: event.severity,
        title: event.title, fingerprint: event.fingerprint,
        stateFrom: event.stateFrom, stateTo: event.stateTo,
        reason: decision.reason, body: event.body, payload: event.payload,
      },
    });
    if (decision.action === 'emitted') {
      emitAlert(event);
      await sendAlertTelegram(event);
    }
    return decision;
  }
}
