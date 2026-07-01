/**
 * Central type definitions for the skill verification harness.
 *
 * These types are intentionally framework-agnostic. A "skill" is described by a
 * contract, executed by a model adapter, and judged by validators. Everything
 * else (telemetry, reporting, replay) is derived from the run results defined here.
 */

/** Terminal status a skill run can report. */
export type SkillStatus = "answered" | "insufficient_evidence" | "refused";

/** Confidence self-reported by the model. Advisory only; never trusted by validators. */
export type Confidence = "low" | "medium" | "high";

/** A single source-grounding citation: a file and a 1-indexed line number. */
export interface Citation {
  file: string;
  line: number;
}

/** A factual claim that must be backed by citations when the skill answers. */
export interface Claim {
  text: string;
  citations: Citation[];
}

/** A tool invocation reported by the model as part of its reasoning. */
export interface ToolCall {
  tool: string;
  arguments: Record<string, unknown>;
}

/**
 * The structured output every run of the `codebase-understanding` skill must
 * produce. This is the object validators inspect.
 */
export interface SkillOutput {
  status: SkillStatus;
  answer: string;
  claims: Claim[];
  toolCalls: ToolCall[];
  confidence?: Confidence;
}

/** Token accounting for a single model call. Estimated for the mock adapters. */
export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  /** True when the numbers are estimated (e.g. mock adapters), not provider-reported. */
  estimated: boolean;
}

/** What a model adapter returns for one call. */
export interface ModelResponse {
  output: SkillOutput;
  usage: TokenUsage;
  /**
   * Optional deterministic latency the adapter wants recorded instead of measured
   * wall-clock time. Used by the mock adapters so reports show realistic,
   * reproducible latency distributions. Clearly labeled as estimated in the report.
   */
  simulatedLatencyMs?: number;
}

/** Input handed to the skill. Kept as an open record for forward compatibility. */
export interface SkillInput {
  question: string;
  [key: string]: unknown;
}

/** A single eval test case. */
export interface TestCase {
  id: string;
  name: string;
  input: SkillInput;
  /** Which category this case belongs to. Drives report grouping. */
  kind?: "happy" | "negative";
  expectedStatus: SkillStatus;
  /** Symbols that must appear on at least one cited line when the skill answers. */
  requiredSymbols: string[];
  /** Substrings that must NOT appear in the answer/claims (hallucination guards). */
  forbiddenClaims: string[];
  /** Tools that must be present in the reported tool calls. */
  requiredTools: string[];
  /** Files that must be cited at least once when the skill answers. */
  expectedCitationFiles: string[];
  /** Per-case pass-rate floor. Falls back to the global threshold when omitted. */
  minPassRate?: number;
}

/** Result of a single validator over a single run. */
export interface ValidatorResult {
  validator: string;
  passed: boolean;
  reasons: string[];
  /** Machine-readable detail for debugging and replay artifacts. */
  details: Record<string, unknown>;
}

/** Aggregated verdict for a single run across all validators. */
export interface ValidationSummary {
  passed: boolean;
  failureReasons: string[];
  validators: ValidatorResult[];
}

/** Versioning metadata attached to every run for traceability. */
export interface RunVersions {
  skillContractVersion: string;
  promptVersion: string;
  toolSchemaVersion: string;
}

/** A recorded tool invocation with execution metadata (from the tool registry). */
export interface RecordedToolCall {
  order: number;
  tool: string;
  arguments: Record<string, unknown>;
  ok: boolean;
  error?: string;
  resultSummary: string;
  startedAtMs: number;
  durationMs: number;
}

/** A single OpenTelemetry-style span (simplified; see docs/observability-model.md). */
export interface SpanRecord {
  name: string;
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  startTimeMs: number;
  endTimeMs: number;
  durationMs: number;
  status: "ok" | "error";
  attributes: Record<string, unknown>;
  events: { name: string; timeMs: number; attributes?: Record<string, unknown> }[];
}

/** The full record of one skill execution attempt. */
export interface RunResult {
  runId: string;
  traceId: string;
  skillName: string;
  skillVersion: string;
  modelName: string;
  modelType: string;
  testCaseId: string;
  testCaseName: string;
  attemptIndex: number;
  expectedStatus: SkillStatus;
  input: SkillInput;
  normalizedInput: SkillInput;
  output: SkillOutput;
  toolCalls: RecordedToolCall[];
  validation: ValidationSummary;
  usage: TokenUsage;
  estimatedCostUsd: number;
  latencyMs: number;
  latencyEstimated: boolean;
  retries: number;
  spans: SpanRecord[];
  versions: RunVersions;
  startedAt: string;
  endedAt: string;
  /** True when the model call itself threw (e.g. a stub adapter). */
  errored: boolean;
  errorMessage?: string;
}
