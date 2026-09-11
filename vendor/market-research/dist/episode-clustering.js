/**
 * Clusters consecutive/overlapping events into independent episodes to prevent sample inflation.
 * (e.g. 4 consecutive FVGs during one single directional impulse treated as 1 independent episode).
 */
export function clusterEventsIntoEpisodes(events, options = {}) {
    if (events.length === 0)
        return [];
    const maxGap = options.maxCandleGap ?? 3;
    const sorted = [...events].sort((a, b) => a.originIndex - b.originIndex);
    const episodes = [];
    let currentCluster = [sorted[0]];
    for (let i = 1; i < sorted.length; i++) {
        const current = sorted[i];
        const prev = currentCluster[currentCluster.length - 1];
        const sameType = current.type === prev.type;
        const sameDir = current.direction === prev.direction;
        const withinGap = (current.originIndex - prev.originIndex) <= maxGap;
        if (sameType && sameDir && withinGap) {
            currentCluster.push(current);
        }
        else {
            episodes.push(buildEpisode(currentCluster));
            currentCluster = [current];
        }
    }
    if (currentCluster.length > 0) {
        episodes.push(buildEpisode(currentCluster));
    }
    return episodes;
}
function buildEpisode(cluster) {
    const first = cluster[0];
    const last = cluster[cluster.length - 1];
    return {
        episodeId: `episode-${first.type}-${first.direction}-${first.detectedAt}`,
        type: first.type,
        direction: first.direction,
        startTime: first.detectedAt,
        endTime: last.detectedAt,
        originIndex: first.originIndex,
        eventsCount: cluster.length,
        representativeEvent: first,
        allEvents: cluster
    };
}
//# sourceMappingURL=episode-clustering.js.map