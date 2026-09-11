export const SWING_PRESETS = {
    micro: { leftBars: 1, rightBars: 1 },
    minor: { leftBars: 2, rightBars: 2 },
    internal: { leftBars: 3, rightBars: 3 },
    intermediate: { leftBars: 5, rightBars: 5 },
    major: { leftBars: 10, rightBars: 10 },
    external: { leftBars: 10, rightBars: 10 }
};
function checkIsSwingHigh(candles, index, left, right) {
    const target = candles[index];
    for (let offset = -left; offset <= right; offset++) {
        if (offset === 0)
            continue;
        if (candles[index + offset].high.gte(target.high))
            return false;
    }
    return true;
}
function checkIsSwingLow(candles, index, left, right) {
    const target = candles[index];
    for (let offset = -left; offset <= right; offset++) {
        if (offset === 0)
            continue;
        if (candles[index + offset].low.lte(target.low))
            return false;
    }
    return true;
}
/**
 * Detects swing highs and swing lows using symmetrical left/right bar confirmation.
 */
export function detectSwings(candles, options = {}) {
    const left = options.leftBars ?? 2;
    const right = options.rightBars ?? 2;
    const scale = (left >= 10 ? 'major' : left >= 5 ? 'intermediate' : 'minor');
    const strength = options.strength ?? scale;
    const swings = [];
    for (let i = left; i < candles.length - right; i++) {
        const candidate = candles[i];
        const confirmedAtIndex = i + right;
        const confirmedAtTimestamp = candles[confirmedAtIndex]?.timestamp ?? candidate.timestamp;
        if (checkIsSwingHigh(candles, i, left, right)) {
            swings.push({
                id: `swing-high-${strength}-${candidate.timestamp}`,
                type: 'high',
                index: i,
                timestamp: candidate.timestamp,
                price: candidate.high,
                confirmedAtIndex,
                confirmedAtTimestamp,
                strength,
                scale
            });
        }
        if (checkIsSwingLow(candles, i, left, right)) {
            swings.push({
                id: `swing-low-${strength}-${candidate.timestamp}`,
                type: 'low',
                index: i,
                timestamp: candidate.timestamp,
                price: candidate.low,
                confirmedAtIndex,
                confirmedAtTimestamp,
                strength,
                scale
            });
        }
    }
    return swings.sort((a, b) => a.index - b.index);
}
/**
 * Detects multi-scale market swings across micro, minor, intermediate, and major resolutions.
 */
export function detectMultiScaleSwings(candles) {
    return {
        micro: detectSwings(candles, { ...SWING_PRESETS.micro, strength: 'micro' }),
        minor: detectSwings(candles, { ...SWING_PRESETS.minor, strength: 'minor' }),
        intermediate: detectSwings(candles, { ...SWING_PRESETS.intermediate, strength: 'intermediate' }),
        major: detectSwings(candles, { ...SWING_PRESETS.major, strength: 'major' })
    };
}
//# sourceMappingURL=swings.js.map