export interface HypothesisTest {
  readonly id: string;
  readonly description: string;
  readonly pValue: number;
  readonly effectSize?: number | undefined;
}

export interface AdjustedTestResult extends HypothesisTest {
  readonly adjustedPValue: number;
  readonly isSignificant: boolean;
  readonly rank: number;
}

/**
 * Applies the Benjamini-Hochberg (BH) procedure to control the False Discovery Rate (FDR).
 */
export function adjustBenjaminiHochberg(
  tests: readonly HypothesisTest[],
  alpha: number = 0.05
): readonly AdjustedTestResult[] {
  const m = tests.length;
  if (m === 0) return [];

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
  const adjustedPValues = new Array<number>(m);
  let runningMin = 1.0;
  for (let i = m - 1; i >= 0; i--) {
    runningMin = Math.min(runningMin, rawQ[i]!);
    adjustedPValues[i] = runningMin;
  }

  // Build result array in sorted order first, then restore original input order
  const ranked = sorted.map((item, idx) => ({
    ...item.test,
    rank: idx + 1,
    adjustedPValue: adjustedPValues[idx]!,
    isSignificant: adjustedPValues[idx]! <= alpha,
    originalIndex: item.originalIndex
  }));

  // Restore original input order so positional correspondence is preserved for callers
  const result = new Array<AdjustedTestResult>(m);
  for (const r of ranked) {
    result[r.originalIndex] = { id: r.id, description: r.description, pValue: r.pValue, effectSize: r.effectSize, rank: r.rank, adjustedPValue: r.adjustedPValue, isSignificant: r.isSignificant };
  }
  return result;
}

/**
 * Applies the Holm-Bonferroni step-down procedure to strongly control Family-Wise Error Rate (FWER).
 */
export function adjustHolmBonferroni(
  tests: readonly HypothesisTest[],
  alpha: number = 0.05
): readonly AdjustedTestResult[] {
  const m = tests.length;
  if (m === 0) return [];

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

export interface FamilyHypothesisTest extends HypothesisTest {
  readonly family: string;
}

export function adjustByHypothesisFamily(
  tests: readonly FamilyHypothesisTest[],
  procedure: 'benjamini_hochberg' | 'holm_bonferroni' = 'benjamini_hochberg',
  alpha: number = 0.05
): ReadonlyMap<string, readonly AdjustedTestResult[]> {
  const families = new Map<string, FamilyHypothesisTest[]>();
  for (const t of tests) {
    const list = families.get(t.family) ?? [];
    list.push(t);
    families.set(t.family, list);
  }

  const resultMap = new Map<string, readonly AdjustedTestResult[]>();
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
  private readonly tests: HypothesisTest[] = [];
  private readonly familyTests: FamilyHypothesisTest[] = [];

  register(test: HypothesisTest): void {
    this.tests.push(test);
  }

  registerFamilyTest(test: FamilyHypothesisTest): void {
    this.familyTests.push(test);
    this.tests.push(test);
  }

  getAll(): readonly HypothesisTest[] {
    return this.tests;
  }

  applyBenjaminiHochberg(alpha: number = 0.05): readonly AdjustedTestResult[] {
    return adjustBenjaminiHochberg(this.tests, alpha);
  }

  applyHolmBonferroni(alpha: number = 0.05): readonly AdjustedTestResult[] {
    return adjustHolmBonferroni(this.tests, alpha);
  }

  applyByFamily(
    procedure: 'benjamini_hochberg' | 'holm_bonferroni' = 'benjamini_hochberg',
    alpha: number = 0.05
  ): ReadonlyMap<string, readonly AdjustedTestResult[]> {
    return adjustByHypothesisFamily(this.familyTests, procedure, alpha);
  }
}
