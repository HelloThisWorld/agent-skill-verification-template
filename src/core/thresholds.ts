/**
 * Release-gate thresholds and the gate decision function.
 *
 * The gate is deliberately simple and explicit: a run set PASSES only when the
 * overall pass rate clears the global threshold AND every test case clears its
 * own floor (its `minPassRate`, or the global threshold when unset).
 */

export const DEFAULT_THRESHOLD = 0.9;
export const DEFAULT_RUNS_PER_CASE = 10;

/** Demo pricing used only to compute an illustrative estimated cost. */
export const DEMO_PRICING = {
  /** USD per 1K input tokens (illustrative, not tied to any real provider). */
  inputPer1k: 0.0005,
  /** USD per 1K output tokens (illustrative, not tied to any real provider). */
  outputPer1k: 0.0015,
} as const;

export interface PerCaseGate {
  id: string;
  passRate: number;
  minPassRate: number;
}

export interface GateInput {
  threshold: number;
  overallPassRate: number;
  perCase: PerCaseGate[];
}

export interface GateResult {
  passed: boolean;
  reasons: string[];
}

/**
 * Decide whether a run set passes the release gate.
 * Returns the boolean verdict plus human-readable reasons for any failure.
 */
export function evaluateGate(input: GateInput): GateResult {
  const reasons: string[] = [];

  if (input.overallPassRate < input.threshold) {
    reasons.push(
      `overall pass rate ${fmt(input.overallPassRate)} is below threshold ${fmt(input.threshold)}`,
    );
  }

  for (const c of input.perCase) {
    if (c.passRate < c.minPassRate) {
      reasons.push(
        `test case "${c.id}" pass rate ${fmt(c.passRate)} is below floor ${fmt(c.minPassRate)}`,
      );
    }
  }

  return { passed: reasons.length === 0, reasons };
}

function fmt(rate: number): string {
  return `${(rate * 100).toFixed(1)}%`;
}
