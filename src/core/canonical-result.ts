import { z } from "zod";
import type { EvalSummary } from "../reporting/summary-json.js";
import { TOOL_NAME } from "./version.js";

/**
 * Canonical verification result — the versioned, machine-readable document the
 * CLI writes as `summary.json`. Every other report format (terminal, JUnit,
 * HTML) is derived from this document, and the `report` command can regenerate
 * them from it without rerunning any evaluation.
 *
 * Metrics the verifier cannot measure are `null`, never fabricated.
 */

export const CANONICAL_SCHEMA_VERSION = "1.0.0";

const resultEnum = z.enum(["passed", "failed"]);

const caseResultSchema = z.object({
  id: z.string(),
  name: z.string(),
  kind: z.string(),
  expectedStatus: z.string(),
  runs: z.number().int().nonnegative(),
  passedRuns: z.number().int().nonnegative(),
  failedRuns: z.number().int().nonnegative(),
  passRate: z.number().min(0).max(1),
  citationValidRate: z.number().min(0).max(1),
  minPassRate: z.number().min(0).max(1),
  flaky: z.boolean(),
  result: resultEnum,
});

export const canonicalResultSchema = z.object({
  schemaVersion: z.literal(CANONICAL_SCHEMA_VERSION),
  tool: z.object({
    name: z.literal(TOOL_NAME),
    version: z.string().min(1),
  }),
  skill: z.object({
    name: z.string().min(1),
    version: z.string().min(1),
    path: z.string().min(1),
  }),
  configuration: z.object({
    cases: z.string().min(1),
    runsPerCase: z.number().int().positive(),
    threshold: z.number().min(0).max(1),
    seed: z.number().int().nullable(),
    adapter: z.string().min(1),
  }),
  summary: z.object({
    result: resultEnum,
    cases: z.number().int().nonnegative(),
    totalRuns: z.number().int().nonnegative(),
    passedRuns: z.number().int().nonnegative(),
    failedRuns: z.number().int().nonnegative(),
    passRate: z.number().min(0).max(1),
    flakyCases: z.number().int().nonnegative(),
  }),
  gate: z.object({
    passed: z.boolean(),
    reasons: z.array(z.string()),
  }),
  metrics: z.object({
    latencyMs: z.object({
      p50: z.number().nonnegative(),
      p95: z.number().nonnegative(),
      p99: z.number().nonnegative(),
      estimated: z.boolean(),
    }),
    tokenUsage: z.object({
      inputTotal: z.number().nonnegative(),
      outputTotal: z.number().nonnegative(),
      estimated: z.boolean(),
    }),
    schemaValidRate: z.number().min(0).max(1),
    structuredOutputRate: z.number().min(0).max(1),
    citationValidityRate: z.number().min(0).max(1),
    unsupportedClaimRate: z.number().min(0).max(1),
    toolErrorRate: z.number().min(0).max(1),
    estimatedCostUsd: z.number().nonnegative(),
    /** Not measured by this verifier version; always null (never fabricated). */
    toolSelectionAccuracy: z.null(),
    /** Not measured by this verifier version; always null (never fabricated). */
    refusalAccuracy: z.null(),
  }),
  caseResults: z.array(caseResultSchema),
  failureBreakdown: z.array(z.object({ reason: z.string(), count: z.number().int().positive() })),
  failedRuns: z.array(
    z.object({
      runId: z.string(),
      testCaseId: z.string(),
      failureReasons: z.array(z.string()),
      replay: z.string(),
    }),
  ),
  notes: z.array(z.string()),
  artifacts: z.object({
    summary: z.string(),
    junit: z.string().nullable(),
    html: z.string().nullable(),
    events: z.string(),
    metrics: z.string(),
    replays: z.string().nullable(),
  }),
  createdAt: z.string().min(1),
});

export type CanonicalResult = z.infer<typeof canonicalResultSchema>;
export type CanonicalCaseResult = z.infer<typeof caseResultSchema>;

export interface BuildCanonicalParams {
  summary: EvalSummary;
  toolVersion: string;
  skillPath: string;
  casesPath: string;
  adapter: string;
  seed: number | null;
  /** Replay file (relative to the output dir) per failed run id; null when replays are disabled. */
  replayFileByRunId: Map<string, string> | null;
  artifacts: CanonicalResult["artifacts"];
  createdAt: string;
}

/** Build the canonical result from the internal eval summary + raw runs. */
export function buildCanonicalResult(params: BuildCanonicalParams): CanonicalResult {
  const s = params.summary;
  const caseResults: CanonicalCaseResult[] = s.perCase.map((c) => ({
    id: c.id,
    name: c.name,
    kind: c.kind,
    expectedStatus: c.expectedStatus,
    runs: c.runs,
    passedRuns: c.passed,
    failedRuns: c.failureCount,
    passRate: c.passRate,
    citationValidRate: c.citationValidRate,
    minPassRate: c.minPassRate,
    flaky: c.passed > 0 && c.failureCount > 0,
    result: c.result === "PASSED" ? "passed" : "failed",
  }));

  const flakyCases = caseResults.filter((c) => c.flaky).length;

  return {
    schemaVersion: CANONICAL_SCHEMA_VERSION,
    tool: { name: TOOL_NAME, version: params.toolVersion },
    skill: { name: s.skill.name, version: s.skill.version, path: params.skillPath },
    configuration: {
      cases: params.casesPath,
      runsPerCase: s.config.runsPerCase,
      threshold: s.config.threshold,
      seed: params.seed,
      adapter: params.adapter,
    },
    summary: {
      result: s.result === "PASSED" ? "passed" : "failed",
      cases: s.totals.testCases,
      totalRuns: s.totals.totalRuns,
      passedRuns: s.totals.passedRuns,
      failedRuns: s.totals.failedRuns,
      passRate: s.metrics.passRate,
      flakyCases,
    },
    gate: { passed: s.result === "PASSED", reasons: s.gateReasons },
    metrics: {
      latencyMs: {
        p50: s.metrics.latencyMsP50,
        p95: s.metrics.latencyMsP95,
        p99: s.metrics.latencyMsP99,
        estimated: s.measurement.latencyEstimated,
      },
      tokenUsage: {
        inputTotal: s.metrics.tokenInputTotal,
        outputTotal: s.metrics.tokenOutputTotal,
        estimated: s.measurement.usageEstimated,
      },
      schemaValidRate: s.metrics.schemaValidRate,
      structuredOutputRate: s.metrics.schemaValidRate,
      citationValidityRate: s.metrics.citationValidRate,
      unsupportedClaimRate: s.metrics.unsupportedClaimRate,
      toolErrorRate: s.metrics.toolErrorRate,
      estimatedCostUsd: s.metrics.estimatedCostUsd,
      toolSelectionAccuracy: null,
      refusalAccuracy: null,
    },
    caseResults,
    failureBreakdown: s.failureBreakdown,
    failedRuns: s.failedRuns.map((f) => ({
      runId: f.runId,
      testCaseId: f.testCaseId,
      failureReasons: f.failureReasons,
      replay: params.replayFileByRunId?.get(f.runId) ?? f.artifact,
    })),
    notes: s.notes,
    artifacts: params.artifacts,
    createdAt: params.createdAt,
  };
}

/**
 * Reconstruct the internal EvalSummary shape from a canonical result so the
 * HTML report builder can be reused by the `report` command. Latency detail
 * beyond the recorded percentiles is not recoverable and is not fabricated.
 */
export function canonicalToEvalSummary(c: CanonicalResult): EvalSummary {
  return {
    generatedAt: c.createdAt,
    skill: { name: c.skill.name, version: c.skill.version },
    model: { name: c.configuration.adapter, type: "recorded" },
    config: {
      runsPerCase: c.configuration.runsPerCase,
      threshold: c.configuration.threshold,
      outputDir: ".",
    },
    totals: {
      testCases: c.summary.cases,
      totalRuns: c.summary.totalRuns,
      passedRuns: c.summary.passedRuns,
      failedRuns: c.summary.failedRuns,
    },
    metrics: {
      totalRuns: c.summary.totalRuns,
      passedRuns: c.summary.passedRuns,
      failedRuns: c.summary.failedRuns,
      passRate: c.summary.passRate,
      schemaValidRate: c.metrics.schemaValidRate,
      citationValidRate: c.metrics.citationValidityRate,
      unsupportedClaimRate: c.metrics.unsupportedClaimRate,
      toolErrorRate: c.metrics.toolErrorRate,
      retryCount: 0,
      latencyMsP50: c.metrics.latencyMs.p50,
      latencyMsP95: c.metrics.latencyMs.p95,
      latencyMsP99: c.metrics.latencyMs.p99,
      tokenInputTotal: c.metrics.tokenUsage.inputTotal,
      tokenOutputTotal: c.metrics.tokenUsage.outputTotal,
      estimatedCostUsd: c.metrics.estimatedCostUsd,
    },
    measurement: {
      latencyEstimated: c.metrics.latencyMs.estimated,
      usageEstimated: c.metrics.tokenUsage.estimated,
    },
    result: c.summary.result === "passed" ? "PASSED" : "FAILED",
    gateReasons: c.gate.reasons,
    perCase: c.caseResults.map((r) => ({
      id: r.id,
      name: r.name,
      kind: r.kind,
      expectedStatus: r.expectedStatus,
      runs: r.runs,
      passed: r.passedRuns,
      passRate: r.passRate,
      citationValidRate: r.citationValidRate,
      failureCount: r.failedRuns,
      minPassRate: r.minPassRate,
      result: r.result === "passed" ? "PASSED" : "FAILED",
    })),
    failureBreakdown: c.failureBreakdown,
    failedRuns: c.failedRuns.map((f) => ({
      runId: f.runId,
      testCaseId: f.testCaseId,
      failureReasons: f.failureReasons,
      artifact: f.replay,
    })),
    notes: c.notes,
  };
}

/** Validate a canonical result document, throwing a descriptive error on mismatch. */
export function parseCanonicalResult(raw: unknown, source: string): CanonicalResult {
  const parsed = canonicalResultSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(`Invalid canonical verification result in ${source}:\n${parsed.error.toString()}`);
  }
  return parsed.data;
}
