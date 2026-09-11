import { Decimal } from 'decimal.js';
/**
 * Calculates Volume Profile (POC, VAH, VAL) deterministically over a series of candles.
 */
function computeValueAreaBounds(levels, pocIdx, targetVolume) {
    let lowIdx = pocIdx;
    let highIdx = pocIdx;
    let accumulated = levels[pocIdx].volume;
    // Outward expansion from POC comparing adjacent higher/lower volume bins
    while (accumulated.lt(targetVolume) && (lowIdx > 0 || highIdx < levels.length - 1)) {
        const nextLowVol = lowIdx > 0 ? levels[lowIdx - 1].volume : new Decimal(-1);
        const nextHighVol = highIdx < levels.length - 1 ? levels[highIdx + 1].volume : new Decimal(-1);
        if (nextHighVol.gte(nextLowVol) && highIdx < levels.length - 1) {
            highIdx++;
            accumulated = accumulated.plus(levels[highIdx].volume);
        }
        else if (lowIdx > 0) {
            lowIdx--;
            accumulated = accumulated.plus(levels[lowIdx].volume);
        }
    }
    return { val: levels[lowIdx].price, vah: levels[highIdx].price };
}
export function calculateVolumeProfile(candles, options) {
    if (candles.length === 0) {
        return {
            poc: new Decimal(0),
            vah: new Decimal(0),
            val: new Decimal(0),
            totalVolume: new Decimal(0),
            levels: []
        };
    }
    const binSize = options.binSize;
    const vaRatio = options.valueAreaRatio ?? new Decimal(0.7);
    const volumeMap = new Map();
    let totalVolume = new Decimal(0);
    for (const c of candles) {
        totalVolume = totalVolume.plus(c.volume);
        const mid = c.high.plus(c.low).dividedBy(2);
        const binPrice = mid.dividedBy(binSize).floor().times(binSize);
        const key = binPrice.toString();
        const existing = volumeMap.get(key);
        if (existing) {
            existing.volume = existing.volume.plus(c.volume);
        }
        else {
            volumeMap.set(key, { price: binPrice, volume: c.volume });
        }
    }
    const levels = Array.from(volumeMap.values()).sort((a, b) => a.price.cmp(b.price));
    let pocIdx = 0;
    for (let i = 1; i < levels.length; i++) {
        if (levels[i].volume.gt(levels[pocIdx].volume))
            pocIdx = i;
    }
    const poc = levels[pocIdx]?.price ?? new Decimal(0);
    const targetVaVolume = totalVolume.times(vaRatio);
    const { val, vah } = computeValueAreaBounds(levels, pocIdx, targetVaVolume);
    return {
        poc,
        vah,
        val,
        totalVolume,
        levels
    };
}
//# sourceMappingURL=volume-profile.js.map