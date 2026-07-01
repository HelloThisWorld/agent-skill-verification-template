import type { RunResult } from "../core/types.js";
import { VALIDATOR_NAMES } from "../validators/validation-summary.js";

/**
 * Aggregate metrics computed from a set of run results.
 *
 * Token counts, cost, and latency are ESTIMATED/DEMO values for the offline mock
 * adapters (see docs/model-adapters.md). Rates are exact over the runs provided.
 */
export interface MetricsSummary {
  totalRuns: number;
  passedRuns: number;
  failedRuns: number;
  passRate: number;
  schemaValidRate: number;
  citationValidRate: number;
  /** Fraction of runs where the unsupported-claim validator FAILED (lower is better). */
  unsupportedClaimRate: number;
  /** Fraction of runs where the tool-call validator FAILED (lower is better). */
  toolErrorRate: number;
  retryCount: number;
  latencyMsP50: number;
  latencyMsP95: number;
  latencyMsP99: number;
  tokenInputTotal: number;
  tokenOutputTotal: number;
  estimatedCostUsd: number;
}

/** Nearest-rank percentile. Returns 0 for an empty input. */
export function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.ceil((p / 100) * sorted.length);
  const idx = Math.min(sorted.length - 1, Math.max(0, rank - 1));
  return sorted[idx];
}

function validatorPassed(run: RunResult, name: string): boolean {
  const v = run.validation.validators.find((x) => x.validator === name);
  return v ? v.passed : false;
}

function validatorFailed(run: RunResult, name: string): boolean {
  const v = run.validation.validators.find((x) => x.validator === name);
  return v ? !v.passed : false;
}

function sum(values: number[]): number {
  return values.reduce((a, b) => a + b, 0);
}

function round(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

export function computeMetrics(runs: RunResult[]): MetricsSummary {
  const total = runs.length;
  const rate = (n: number): number => (total === 0 ? 0 : round(n / total, 4));

  const passed = runs.filter((r) => r.validation.passed).length;
  const schemaValid = runs.filter((r) => validatorPassed(r, VALIDATOR_NAMES.schema)).length;
  const citationValid = runs.filter((r) => validatorPassed(r, VALIDATOR_NAMES.citation)).length;
  const unsupported = runs.filter((r) => validatorFailed(r, VALIDATOR_NAMES.unsupportedClaim)).length;
  const toolErrors = runs.filter((r) => validatorFailed(r, VALIDATOR_NAMES.toolCall)).length;

  const latencies = runs.map((r) => r.latencyMs);

  return {
    totalRuns: total,
    passedRuns: passed,
    failedRuns: total - passed,
    passRate: rate(passed),
    schemaValidRate: rate(schemaValid),
    citationValidRate: rate(citationValid),
    unsupportedClaimRate: rate(unsupported),
    toolErrorRate: rate(toolErrors),
    retryCount: sum(runs.map((r) => r.retries)),
    latencyMsP50: percentile(latencies, 50),
    latencyMsP95: percentile(latencies, 95),
    latencyMsP99: percentile(latencies, 99),
    tokenInputTotal: sum(runs.map((r) => r.usage.inputTokens)),
    tokenOutputTotal: sum(runs.map((r) => r.usage.outputTokens)),
    estimatedCostUsd: round(sum(runs.map((r) => r.estimatedCostUsd)), 6),
  };
}
