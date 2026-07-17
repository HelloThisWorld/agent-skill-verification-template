import { existsSync } from "node:fs";
import { parseTestCases, readStructuredFile } from "./case-loader.js";
import { VerificationTimeoutError } from "./errors.js";
import { loadSkillContract, type SkillContract } from "./skill-contract.js";
import { resolveFromRoot } from "./paths.js";
import { newRunId, newTraceId } from "./run-id.js";
import { DEMO_PRICING } from "./thresholds.js";
import type {
  RunResult,
  RunVersions,
  SkillInput,
  SkillOutput,
  TestCase,
  TokenUsage,
  ValidationSummary,
  ValidatorResult,
} from "./types.js";
import { StructuredLogger } from "../telemetry/logger.js";
import { createRunTelemetry } from "../telemetry/telemetry-context.js";
import type { Tracer } from "../telemetry/tracing.js";
import { createToolRegistry } from "../tools/tool-registry.js";
import { createAdapter, type ModelAdapter, type ModelRunContext } from "../models/model-adapter.js";
import { validateSchema } from "../validators/schema-validator.js";
import { validateCitations } from "../validators/citation-validator.js";
import { validateUnsupportedClaims } from "../validators/unsupported-claim-validator.js";
import { validateToolCalls } from "../validators/tool-call-validator.js";
import {
  combineValidatorResults,
  erroredValidationSummary,
  type ValidatorInput,
} from "../validators/validation-summary.js";
import { buildSummary, type EvalSummary } from "../reporting/summary-json.js";

/**
 * The eval harness: run each test case N times against a skill + model adapter,
 * validate every output, and produce a summary + full run records. Reporting and
 * file I/O are handled separately (see reporting/write-reports.ts) so this module
 * stays pure and testable.
 */

export interface EvalOptions {
  skillName: string;
  modelName: string;
  runsPerCase: number;
  threshold: number;
  outputDir: string;
}

export interface EvalResult {
  summary: EvalSummary;
  runs: RunResult[];
  logJsonl: string;
}

function errMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function loadTestCaseFile(relPath: string, defaultKind: "happy" | "negative"): TestCase[] {
  const abs = resolveFromRoot(relPath);
  const raw = readStructuredFile(abs, "Test cases file");
  return parseTestCases(raw, relPath, defaultKind);
}

/**
 * Load happy-path cases for a skill plus its negative cases. A skill may ship its
 * own `testcases/<skill>-negative.json`; when absent, the shared
 * `testcases/negative-cases.json` is used. This keeps each skill's negatives
 * relevant to its own contract (a glossary skill should not be graded against
 * codebase questions).
 */
export function loadTestCases(skillName: string): TestCase[] {
  const happy = loadTestCaseFile(`testcases/${skillName}.json`, "happy");
  const perSkillNeg = `testcases/${skillName}-negative.json`;
  const sharedNeg = "testcases/negative-cases.json";
  const negativeRel = existsSync(resolveFromRoot(perSkillNeg))
    ? perSkillNeg
    : existsSync(resolveFromRoot(sharedNeg))
      ? sharedNeg
      : null;
  const negative = negativeRel ? loadTestCaseFile(negativeRel, "negative") : [];
  return [...happy, ...negative];
}

function normalizeInput(input: SkillInput): SkillInput {
  const question = String(input.question ?? "")
    .trim()
    .replace(/\s+/g, " ");
  return { ...input, question };
}

function estimateCost(usage: TokenUsage): number {
  const cost =
    (usage.inputTokens / 1000) * DEMO_PRICING.inputPer1k +
    (usage.outputTokens / 1000) * DEMO_PRICING.outputPer1k;
  return Math.round(cost * 1e6) / 1e6;
}

/** Run all validators, emitting a span and structured log per validator. */
function runValidators(
  tracer: Tracer,
  logger: ReturnType<StructuredLogger["child"]>,
  input: ValidatorInput,
): ValidationSummary {
  const steps: { span: string; run: () => ValidatorResult }[] = [
    { span: "schema.validation", run: () => validateSchema(input) },
    { span: "citation.validation", run: () => validateCitations(input) },
    { span: "unsupported_claim.validation", run: () => validateUnsupportedClaims(input) },
    { span: "tool_call.validation", run: () => validateToolCalls(input) },
  ];

  const results: ValidatorResult[] = [];
  for (const step of steps) {
    const span = tracer.startSpan(step.span, {});
    const result = step.run();
    span.setAttribute("passed", result.passed);
    span.end(result.passed ? "ok" : "error");
    if (!result.passed) {
      logger.log(`${result.validator}_validation_failed`, {
        failure_reason: result.reasons[0],
        reasons: result.reasons,
      });
    }
    results.push(result);
  }

  const summary = combineValidatorResults(results);
  const decision = tracer.startSpan("final.decision", { passed: summary.passed });
  decision.end(summary.passed ? "ok" : "error");
  return summary;
}

interface AttemptParams {
  adapter: ModelAdapter;
  contract: SkillContract;
  testCase: TestCase;
  attemptIndex: number;
  rootLogger: StructuredLogger;
  modelName: string;
  /** Optional global seed mixed into the per-attempt deterministic seed. */
  seed?: number;
}

async function runAttempt(params: AttemptParams): Promise<RunResult> {
  const { adapter, contract, testCase, attemptIndex, rootLogger, modelName } = params;

  const runId = newRunId();
  const traceId = newTraceId();
  const seed =
    params.seed === undefined
      ? `${testCase.id}#${attemptIndex}`
      : `${params.seed}:${testCase.id}#${attemptIndex}`;
  const startedAt = new Date().toISOString();
  const versions: RunVersions = {
    skillContractVersion: contract.version,
    promptVersion: contract.promptVersion,
    toolSchemaVersion: contract.toolSchemaVersion,
  };

  const { logger, tracer } = createRunTelemetry(rootLogger, traceId, {
    run_id: runId,
    skill_name: contract.name,
    skill_version: contract.version,
    model_name: modelName,
    test_case_id: testCase.id,
    attempt_index: attemptIndex,
    prompt_version: versions.promptVersion,
    tool_schema_version: versions.toolSchemaVersion,
  });

  const tools = createToolRegistry(contract.name, contract.fixtureRoot);
  const rootSpan = tracer.startSpan("skill.run", {
    "skill.name": contract.name,
    "model.name": modelName,
    "test_case.id": testCase.id,
    "attempt.index": attemptIndex,
  });
  logger.log("run_started", {
    question: testCase.input.question,
    expected_status: testCase.expectedStatus,
  });

  const normalizedInput = await tracer.withSpan("input.normalization", {}, () =>
    normalizeInput(testCase.input),
  );
  logger.log("input_normalized", {});

  const modelCtx: ModelRunContext = {
    runId,
    traceId,
    skill: contract,
    input: normalizedInput,
    tools,
    tracer,
    logger,
    versions,
    modelName,
    seed,
  };

  let output: SkillOutput | null = null;
  let usage: TokenUsage = { inputTokens: 0, outputTokens: 0, estimated: true };
  let simulatedLatencyMs: number | undefined;
  let errored = false;
  let errorMessage: string | undefined;

  const startMs = Date.now();
  try {
    const response = await adapter.generate(modelCtx);
    output = response.output;
    usage = response.usage;
    simulatedLatencyMs = response.simulatedLatencyMs;
  } catch (error) {
    errored = true;
    errorMessage = errMessage(error);
    logger.log("model_error", { message: errorMessage });
  }
  const measuredLatencyMs = Date.now() - startMs;
  const latencyMs = simulatedLatencyMs ?? measuredLatencyMs;

  let validation: ValidationSummary;
  if (errored || !output) {
    validation = erroredValidationSummary(errorMessage ?? "model produced no output");
    output = output ?? {
      status: "refused",
      answer: "",
      claims: [],
      toolCalls: tools.recordedCalls().map((c) => ({ tool: c.tool, arguments: c.arguments })),
      confidence: "low",
    };
  } else {
    validation = runValidators(tracer, logger, { output, testCase, contract });
  }

  logger.log(validation.passed ? "run_passed" : "run_failed", {
    failure_reasons: validation.failureReasons,
  });
  rootSpan.setAttribute("run.passed", validation.passed);
  rootSpan.end(validation.passed ? "ok" : "error");

  const endedAt = new Date().toISOString();

  return {
    runId,
    traceId,
    skillName: contract.name,
    skillVersion: contract.version,
    modelName,
    modelType: adapter.type,
    testCaseId: testCase.id,
    testCaseName: testCase.name,
    attemptIndex,
    expectedStatus: testCase.expectedStatus,
    input: testCase.input,
    normalizedInput,
    output,
    toolCalls: tools.recordedCalls(),
    validation,
    usage,
    estimatedCostUsd: estimateCost(usage),
    latencyMs,
    latencyEstimated: simulatedLatencyMs !== undefined,
    retries: 0,
    spans: tracer.getSpans(),
    versions,
    startedAt,
    endedAt,
    errored,
    errorMessage,
  };
}

/** Options for running an eval over already-loaded contract, cases, and adapter. */
export interface RunCasesOptions {
  contract: SkillContract;
  testCases: TestCase[];
  adapter: ModelAdapter;
  modelName: string;
  runsPerCase: number;
  threshold: number;
  outputDir: string;
  /** Optional global seed; identical seeds produce identical mock-adapter results. */
  seed?: number;
  /** Optional absolute wall-clock deadline (epoch ms). Exceeding it aborts with a timeout. */
  deadlineMs?: number;
}

/**
 * Core reusable entry point: run every case N times against an adapter and
 * build the summary. The higher-level `runEval` wrapper (name-based lookup) and
 * the CLI verification service both delegate here.
 */
export async function runEvalCases(options: RunCasesOptions): Promise<EvalResult> {
  const { contract, testCases, adapter } = options;
  if (testCases.length === 0) {
    throw new Error(`No test cases provided for skill "${contract.name}".`);
  }

  const rootLogger = StructuredLogger.create({
    skill_name: contract.name,
    skill_version: contract.version,
    model_name: options.modelName,
  });
  rootLogger.log("eval_started", {
    runs_per_case: options.runsPerCase,
    threshold: options.threshold,
    test_cases: testCases.length,
  });

  const runs: RunResult[] = [];
  for (const testCase of testCases) {
    for (let attempt = 0; attempt < options.runsPerCase; attempt++) {
      if (options.deadlineMs !== undefined && Date.now() > options.deadlineMs) {
        throw new VerificationTimeoutError(
          `Verification exceeded its deadline after ${runs.length} of ` +
            `${testCases.length * options.runsPerCase} runs.`,
        );
      }
      runs.push(
        await runAttempt({
          adapter,
          contract,
          testCase,
          attemptIndex: attempt,
          rootLogger,
          modelName: options.modelName,
          seed: options.seed,
        }),
      );
    }
  }

  const summary = buildSummary({
    contract,
    modelName: options.modelName,
    modelType: adapter.type,
    runsPerCase: options.runsPerCase,
    threshold: options.threshold,
    outputDir: options.outputDir,
    testCases,
    runs,
    generatedAt: new Date().toISOString(),
  });

  rootLogger.log("eval_completed", {
    result: summary.result,
    pass_rate: summary.metrics.passRate,
  });

  return { summary, runs, logJsonl: rootLogger.toJsonl() };
}

export async function runEval(options: EvalOptions): Promise<EvalResult> {
  const contract = loadSkillContract(options.skillName);
  const testCases = loadTestCases(options.skillName);
  if (testCases.length === 0) {
    throw new Error(`No test cases found for skill "${options.skillName}".`);
  }
  const adapter = await createAdapter(options.modelName);
  return runEvalCases({
    contract,
    testCases,
    adapter,
    modelName: options.modelName,
    runsPerCase: options.runsPerCase,
    threshold: options.threshold,
    outputDir: options.outputDir,
  });
}
