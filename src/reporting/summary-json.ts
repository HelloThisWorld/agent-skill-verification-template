import type { RunResult, TestCase } from "../core/types.js";
import type { SkillContract } from "../core/skill-contract.js";
import { evaluateGate } from "../core/thresholds.js";
import { computeMetrics, type MetricsSummary } from "../telemetry/metrics.js";
import { VALIDATOR_NAMES } from "../validators/validation-summary.js";
import { replayArtifactPath } from "../artifacts/replay-artifact.js";

/**
 * The `summary.json` document. This is the single machine-readable source of
 * truth for a run set; the HTML report and Prometheus export are both derived
 * from it (plus the raw runs for artifacts).
 */

export interface PerCaseSummary {
  id: string;
  name: string;
  kind: string;
  expectedStatus: string;
  runs: number;
  passed: number;
  passRate: number;
  citationValidRate: number;
  failureCount: number;
  minPassRate: number;
  result: "PASSED" | "FAILED";
}

export interface FailureBreakdownItem {
  reason: string;
  count: number;
}

export interface FailedRunRef {
  runId: string;
  testCaseId: string;
  failureReasons: string[];
  artifact: string;
}

export interface EvalSummary {
  generatedAt: string;
  skill: { name: string; version: string };
  model: { name: string; type: string };
  config: { runsPerCase: number; threshold: number; outputDir: string };
  totals: { testCases: number; totalRuns: number; passedRuns: number; failedRuns: number };
  metrics: MetricsSummary;
  result: "PASSED" | "FAILED";
  gateReasons: string[];
  perCase: PerCaseSummary[];
  failureBreakdown: FailureBreakdownItem[];
  failedRuns: FailedRunRef[];
  notes: string[];
}

function round(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function validatorPassed(run: RunResult, name: string): boolean {
  const v = run.validation.validators.find((x) => x.validator === name);
  return v ? v.passed : false;
}

/** Group a failure reason into a stable category for the breakdown table. */
function categorize(reason: string): string {
  const parts = reason.split(":").map((p) => p.trim()).filter(Boolean);
  if (parts.length <= 1) return parts[0] ?? reason;
  return `${parts[0]}: ${parts[1]}`;
}

export interface BuildSummaryParams {
  contract: SkillContract;
  modelName: string;
  modelType: string;
  runsPerCase: number;
  threshold: number;
  outputDir: string;
  testCases: TestCase[];
  runs: RunResult[];
  generatedAt: string;
}

export function buildSummary(params: BuildSummaryParams): EvalSummary {
  const { contract, testCases, runs, threshold } = params;
  const metrics = computeMetrics(runs);

  const perCase: PerCaseSummary[] = testCases.map((tc) => {
    const caseRuns = runs.filter((r) => r.testCaseId === tc.id);
    const n = caseRuns.length;
    const passed = caseRuns.filter((r) => r.validation.passed).length;
    const citationValid = caseRuns.filter((r) =>
      validatorPassed(r, VALIDATOR_NAMES.citation),
    ).length;
    const passRate = n === 0 ? 0 : round(passed / n, 4);
    const minPassRate = tc.minPassRate ?? threshold;
    return {
      id: tc.id,
      name: tc.name,
      kind: tc.kind ?? "happy",
      expectedStatus: tc.expectedStatus,
      runs: n,
      passed,
      passRate,
      citationValidRate: n === 0 ? 0 : round(citationValid / n, 4),
      failureCount: n - passed,
      minPassRate,
      result: passRate >= minPassRate ? "PASSED" : "FAILED",
    };
  });

  const gate = evaluateGate({
    threshold,
    overallPassRate: metrics.passRate,
    perCase: perCase.map((c) => ({ id: c.id, passRate: c.passRate, minPassRate: c.minPassRate })),
  });

  const breakdownMap = new Map<string, number>();
  const failedRuns: FailedRunRef[] = [];
  for (const run of runs) {
    if (run.validation.passed) continue;
    failedRuns.push({
      runId: run.runId,
      testCaseId: run.testCaseId,
      failureReasons: run.validation.failureReasons,
      artifact: replayArtifactPath(run.runId),
    });
    for (const reason of run.validation.failureReasons) {
      const key = categorize(reason);
      breakdownMap.set(key, (breakdownMap.get(key) ?? 0) + 1);
    }
  }
  const failureBreakdown = [...breakdownMap.entries()]
    .map(([reason, count]) => ({ reason, count }))
    .sort((a, b) => b.count - a.count || a.reason.localeCompare(b.reason));

  return {
    generatedAt: params.generatedAt,
    skill: { name: contract.name, version: contract.version },
    model: { name: params.modelName, type: params.modelType },
    config: {
      runsPerCase: params.runsPerCase,
      threshold: params.threshold,
      outputDir: params.outputDir,
    },
    totals: {
      testCases: testCases.length,
      totalRuns: metrics.totalRuns,
      passedRuns: metrics.passedRuns,
      failedRuns: metrics.failedRuns,
    },
    metrics,
    result: gate.passed ? "PASSED" : "FAILED",
    gateReasons: gate.reasons,
    perCase,
    failureBreakdown,
    failedRuns,
    notes: [
      "Latency, token counts, and estimated cost are DEMO/ESTIMATED values produced by the offline mock adapters.",
      "Trace spans are simplified demo telemetry (OpenTelemetry-shaped JSON), not exported to a live collector by default.",
      "Citation validation is keyword-based (non-semantic) for the MVP.",
    ],
  };
}

export function summaryToJson(summary: EvalSummary): string {
  return `${JSON.stringify(summary, null, 2)}\n`;
}
