import type { BaseEvent } from '@nemesis-oss/market-events';
export interface EventEpisode<T extends BaseEvent = BaseEvent> {
    readonly episodeId: string;
    readonly type: string;
    readonly direction: 'bullish' | 'bearish';
    readonly startTime: number;
    readonly endTime: number;
    readonly originIndex: number;
    readonly eventsCount: number;
    readonly representativeEvent: T;
    readonly allEvents: readonly T[];
}
export interface EpisodeClusteringOptions {
    readonly maxCandleGap?: number;
    readonly maxTimeGapMs?: number;
}
/**
 * Clusters consecutive/overlapping events into independent episodes to prevent sample inflation.
 * (e.g. 4 consecutive FVGs during one single directional impulse treated as 1 independent episode).
 */
export declare function clusterEventsIntoEpisodes<T extends BaseEvent>(events: readonly T[], options?: EpisodeClusteringOptions): EventEpisode<T>[];
//# sourceMappingURL=episode-clustering.d.ts.map