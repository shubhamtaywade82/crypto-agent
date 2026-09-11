import type { Candle, Timeframe } from './types.js';

export type SessionName = 'asia' | 'london' | 'new_york';

export interface SessionRange {
  readonly name: SessionName;
  readonly startHourUtc: number;
  readonly endHourUtc: number;
}

export const CANONICAL_SESSIONS: readonly SessionRange[] = [
  { name: 'asia', startHourUtc: 0, endHourUtc: 8 },
  { name: 'london', startHourUtc: 7, endHourUtc: 16 },
  { name: 'new_york', startHourUtc: 12, endHourUtc: 21 }
] as const;

export interface SessionEvent {
  readonly id: string;
  readonly session: SessionName;
  readonly symbol: string;
  readonly timeframe: Timeframe;
  readonly timestamp: number;
}

/**
 * Identifies the active trading session for a given UTC timestamp.
 */
export function getActiveSessions(timestampUtcMs: number): SessionName[] {
  const date = new Date(timestampUtcMs);
  const hour = date.getUTCHours();
  const active: SessionName[] = [];

  for (const s of CANONICAL_SESSIONS) {
    if (hour >= s.startHourUtc && hour < s.endHourUtc) {
      active.push(s.name);
    }
  }

  return active;
}
