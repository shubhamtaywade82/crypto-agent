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
export declare function adjustBenjaminiHochberg(tests: readonly HypothesisTest[], alpha?: number): readonly AdjustedTestResult[];
/**
 * Applies the Holm-Bonferroni step-down procedure to strongly control Family-Wise Error Rate (FWER).
 */
export declare function adjustHolmBonferroni(tests: readonly HypothesisTest[], alpha?: number): readonly AdjustedTestResult[];
export interface FamilyHypothesisTest extends HypothesisTest {
    readonly family: string;
}
export declare function adjustByHypothesisFamily(tests: readonly FamilyHypothesisTest[], procedure?: 'benjamini_hochberg' | 'holm_bonferroni', alpha?: number): ReadonlyMap<string, readonly AdjustedTestResult[]>;
/**
 * Thread-safe registry for collecting hypotheses across multi-feature scans.
 */
export declare class HypothesisRegistry {
    private readonly tests;
    private readonly familyTests;
    register(test: HypothesisTest): void;
    registerFamilyTest(test: FamilyHypothesisTest): void;
    getAll(): readonly HypothesisTest[];
    applyBenjaminiHochberg(alpha?: number): readonly AdjustedTestResult[];
    applyHolmBonferroni(alpha?: number): readonly AdjustedTestResult[];
    applyByFamily(procedure?: 'benjamini_hochberg' | 'holm_bonferroni', alpha?: number): ReadonlyMap<string, readonly AdjustedTestResult[]>;
}
//# sourceMappingURL=multiple-testing.d.ts.map