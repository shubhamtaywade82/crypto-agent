import type { AlertEvent } from '../../domain/alerts/types.js';

type AlertListener = (event: AlertEvent) => void;

const listeners = new Set<AlertListener>();

export const onAlertEmitted = (fn: AlertListener): (() => void) => {
  listeners.add(fn);
  return (): void => { listeners.delete(fn); };
};

export const emitAlert = (event: AlertEvent): void => {
  for (const fn of listeners) fn(event);
};
