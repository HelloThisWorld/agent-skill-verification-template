import { describe, expect, it } from "vitest";
import { runEval } from "../src/core/eval-runner.js";

const base = {
  skillName: "codebase-understanding",
  threshold: 0.9,
  outputDir: "reports/__unused__",
};

describe("eval runner — mock adapter", () => {
  it("passes every case deterministically and emits telemetry", async () => {
    const result = await runEval({ ...base, modelName: "mock", runsPerCase: 2 });

    expect(result.summary.result).toBe("PASSED");
    expect(result.summary.metrics.passRate).toBe(1);
    expect(result.runs.length).toBe(result.summary.totals.testCases * 2);
    expect(result.runs.every((r) => r.validation.passed)).toBe(true);

    // Every run carries the full trace-like span sequence.
    const spanNames = result.runs[0].spans.map((s) => s.name);
    for (const expected of [
      "skill.run",
      "input.normalization",
      "tool.selection",
      "tool.execution",
      "output.generation",
      "schema.validation",
      "citation.validation",
      "unsupported_claim.validation",
      "final.decision",
    ]) {
      expect(spanNames).toContain(expected);
    }

    // Structured logs were produced.
    expect(result.logJsonl).toContain("eval_started");
    expect(result.logJsonl).toContain("run_passed");
  });

  it("produces valid citations for answered cases", async () => {
    const result = await runEval({ ...base, modelName: "mock", runsPerCase: 1 });
    const answered = result.runs.filter((r) => r.output.status === "answered");
    expect(answered.length).toBeGreaterThan(0);
    for (const run of answered) {
      expect(run.output.claims.length).toBeGreaterThan(0);
      for (const claim of run.output.claims) {
        expect(claim.citations.length).toBeGreaterThan(0);
      }
    }
  });
});

describe("eval runner — flaky adapter", () => {
  it("produces a mix of failures and replay artifacts, deterministically", async () => {
    const a = await runEval({ ...base, modelName: "mock-flaky", runsPerCase: 5 });
    const b = await runEval({ ...base, modelName: "mock-flaky", runsPerCase: 5 });

    expect(a.summary.result).toBe("FAILED");
    expect(a.summary.metrics.passRate).toBeGreaterThan(0);
    expect(a.summary.metrics.passRate).toBeLessThan(1);
    expect(a.summary.failedRuns.length).toBeGreaterThan(0);
    expect(a.summary.failureBreakdown.length).toBeGreaterThan(0);

    // Deterministic: identical inputs -> identical pass count.
    expect(a.summary.totals.passedRuns).toBe(b.summary.totals.passedRuns);

    // Failed runs carry actionable failure reasons.
    const failed = a.runs.find((r) => !r.validation.passed);
    expect(failed?.validation.failureReasons.length).toBeGreaterThan(0);
  });
});
