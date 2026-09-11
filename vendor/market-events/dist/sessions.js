export const CANONICAL_SESSIONS = [
    { name: 'asia', startHourUtc: 0, endHourUtc: 8 },
    { name: 'london', startHourUtc: 7, endHourUtc: 16 },
    { name: 'new_york', startHourUtc: 12, endHourUtc: 21 }
];
/**
 * Identifies the active trading session for a given UTC timestamp.
 */
export function getActiveSessions(timestampUtcMs) {
    const date = new Date(timestampUtcMs);
    const hour = date.getUTCHours();
    const active = [];
    for (const s of CANONICAL_SESSIONS) {
        if (hour >= s.startHourUtc && hour < s.endHourUtc) {
            active.push(s.name);
        }
    }
    return active;
}
//# sourceMappingURL=sessions.js.map