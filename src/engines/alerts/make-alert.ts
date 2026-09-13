import { makeId } from '../../domain/primitives.js';
import type { AlertEvent } from '../../domain/alerts/types.js';

export const makeAlert = (
  spec: Omit<AlertEvent, 'id'> & { readonly id?: string }
): AlertEvent => ({
  id: spec.id ?? makeId('alert'),
  at: spec.at,
  class: spec.class,
  severity: spec.severity,
  symbol: spec.symbol,
  title: spec.title,
  body: spec.body,
  fingerprint: spec.fingerprint,
  stateFrom: spec.stateFrom,
  stateTo: spec.stateTo,
  payload: spec.payload,
});
