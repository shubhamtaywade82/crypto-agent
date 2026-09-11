import type { Timeframe } from './types.js';
export type SessionName = 'asia' | 'london' | 'new_york';
export interface SessionRange {
    readonly name: SessionName;
    readonly startHourUtc: number;
    readonly endHourUtc: number;
}
export declare const CANONICAL_SESSIONS: readonly SessionRange[];
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
export declare function getActiveSessions(timestampUtcMs: number): SessionName[];
//# sourceMappingURL=sessions.d.ts.map