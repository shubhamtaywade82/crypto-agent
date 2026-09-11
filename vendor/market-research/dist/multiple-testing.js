/**
 * Applies the Benjamini-Hochberg (BH) procedure to control the False Discovery Rate (FDR).
 */
export function adjustBenjaminiHochberg(tests, alpha = 0.05) {
    const m = tests.length;
    if (m === 0)
        return [];
    // Sort by raw p-value ascending
    const sorted = [...tests]
        .map((t, originalIndex) => ({ test: t, originalIndex }))
        .sort((a, b) => a.test.pValue - b.test.pValue);
    // Compute BH adjusted p-values: q_(k) = min_{j >= k} (m / j * p_(j))
    const rawQ = sorted.map((item, idx) => {
        const k = idx + 1;
        return Math.min(1, (m / k) * item.test.pValue);
    });
    // Enforce monotonicity backward from m to 1
    const adjustedPValues = new Array(m);
    let runningMin = 1.0;
    for (let i = m - 1; i >= 0; i--) {
        runningMin = Math.min(runningMin, rawQ[i]);
        adjustedPValues[i] = runningMin;
    }
    // Build result array in sorted order first, then restore original input order
    const ranked = sorted.map((item, idx) => ({
        ...item.test,
        rank: idx + 1,
        adjustedPValue: adjustedPValues[idx],
        isSignificant: adjustedPValues[idx] <= alpha,
        originalIndex: item.originalIndex
    }));
    // Restore original input order so positional correspondence is preserved for callers
    const result = new Array(m);
    for (const r of ranked) {
        result[r.originalIndex] = { id: r.id, description: r.description, pValue: r.pValue, effectSize: r.effectSize, rank: r.rank, adjustedPValue: r.adjustedPValue, isSignificant: r.isSignificant };
    }
    return result;
}
/**
 * Applies the Holm-Bonferroni step-down procedure to strongly control Family-Wise Error Rate (FWER).
 */
export function adjustHolmBonferroni(tests, alpha = 0.05) {
    const m = tests.length;
    if (m === 0)
        return [];
    const sorted = [...tests]
        .map((t, originalIndex) => ({ test: t, originalIndex }))
        .sort((a, b) => a.test.pValue - b.test.pValue);
    // Step-down: p_adj_(k) = (m - k + 1) * p_(k)
    // Monotonicity enforced forward: p_adj_(k) = max_{j <= k} min(1, (m - j + 1) * p_(j))
    let runningMax = 0;
    return sorted.map((item, idx) => {
        const k = idx + 1;
        const stepValue = Math.min(1, (m - k + 1) * item.test.pValue);
        runningMax = Math.max(runningMax, stepValue);
        return {
            ...item.test,
            rank: k,
            adjustedPValue: runningMax,
            isSignificant: runningMax <= alpha
        };
    });
}
export function adjustByHypothesisFamily(tests, procedure = 'benjamini_hochberg', alpha = 0.05) {
    const families = new Map();
    for (const t of tests) {
        const list = families.get(t.family) ?? [];
        list.push(t);
        families.set(t.family, list);
    }
    const resultMap = new Map();
    for (const [family, familyTests] of families) {
        const adjusted = procedure === 'benjamini_hochberg'
            ? adjustBenjaminiHochberg(familyTests, alpha)
            : adjustHolmBonferroni(familyTests, alpha);
        resultMap.set(family, adjusted);
    }
    return resultMap;
}
/**
 * Thread-safe registry for collecting hypotheses across multi-feature scans.
 */
export class HypothesisRegistry {
    tests = [];
    familyTests = [];
    register(test) {
        this.tests.push(test);
    }
    registerFamilyTest(test) {
        this.familyTests.push(test);
        this.tests.push(test);
    }
    getAll() {
        return this.tests;
    }
    applyBenjaminiHochberg(alpha = 0.05) {
        return adjustBenjaminiHochberg(this.tests, alpha);
    }
    applyHolmBonferroni(alpha = 0.05) {
        return adjustHolmBonferroni(this.tests, alpha);
    }
    applyByFamily(procedure = 'benjamini_hochberg', alpha = 0.05) {
        return adjustByHypothesisFamily(this.familyTests, procedure, alpha);
    }
}
//# sourceMappingURL=multiple-testing.js.map