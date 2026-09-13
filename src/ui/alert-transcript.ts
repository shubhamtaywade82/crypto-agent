import type { AlertEvent } from '../domain/alerts/types.js';
import { timeLabel, type TranscriptActor, type TranscriptEntry } from './transcript.js';

const actorOf = (cls: AlertEvent['class']): TranscriptActor => {
  if (cls === 'SYSTEM') return 'SYSTEM';
  if (cls === 'TRADE') return 'EXECUTION';
  if (cls === 'RESEARCH') return 'LEARNING';
  if (cls === 'SIGNAL') return 'AGENT';
  if (cls === 'MACRO') return 'MARKET';
  return 'MARKET';
};

export const alertToTranscript = (event: AlertEvent): TranscriptEntry => ({
  id: event.id,
  at: timeLabel(),
  actor: actorOf(event.class),
  title: `[${event.class}] ${event.title}`,
  lines: event.body.split('\n').filter(Boolean).slice(0, 8),
  detail: event.body,
});
