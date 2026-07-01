import { existsSync, readFileSync } from "node:fs";
import { z } from "zod";
import { loadSkillContract, skillStatusSchema, type SkillContract } from "./skill-contract.js";
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
import { createDefaultToolRegistry } from "../tools/tool-registry.js";
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

const testCaseSchema = z.object({
  id: z.string(),
  name: z.string(),
  input: z.object({ question: z.string() }).passthrough(),
  kind: z.enum(["happy", "negative"]).optional(),
  expectedStatus: skillStatusSchema,
  requiredSymbols: z.array(z.string()).default([]),
  forbiddenClaims: z.array(z.string()).default([]),
  requiredTools: z.array(z.string()).default([]),
  expectedCitationFiles: z.array(z.string()).default([]),
  minPassRate: z.number().min(0).max(1).optional(),
});

function errMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function loadTestCaseFile(relPath: string, defaultKind: "happy" | "negative"): TestCase[] {
  const abs = resolveFromRoot(relPath);
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(abs, "utf8"));
  } catch (error) {
    throw new Error(`Failed to read test cases at ${abs}: ${errMessage(error)}`);
  }
  const parsed = z.array(testCaseSchema).safeParse(raw);
  if (!parsed.success) {
    throw new Error(`Invalid test cases in ${relPath}:\n${parsed.error.toString()}`);
  }
  return parsed.data.map((tc) => ({
    id: tc.id,
    name: tc.name,
    input: { ...tc.input } as SkillInput,
    kind: tc.kind ?? defaultKind,
    expectedStatus: tc.expectedStatus,
    requiredSymbols: tc.requiredSymbols,
    forbiddenClaims: tc.forbiddenClaims,
    requiredTools: tc.requiredTools,
    expectedCitationFiles: tc.expectedCitationFiles,
    minPassRate: tc.minPassRate,
  }));
}

/** Load happy-path cases for a skill plus the shared negative cases. */
export function loadTestCases(skillName: string): TestCase[] {
  const happy = loadTestCaseFile(`testcases/${skillName}.json`, "happy");
  const negativeRel = "testcases/negative-cases.json";
  const negative = existsSync(resolveFromRoot(negativeRel))
    ? loadTestCaseFile(negativeRel, "negative")
    : [];
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
}

async function runAttempt(params: AttemptParams): Promise<RunResult> {
  const { adapter, contract, testCase, attemptIndex, rootLogger, modelName } = params;

  const runId = newRunId();
  const traceId = newTraceId();
  const seed = `${testCase.id}#${attemptIndex}`;
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

  const tools = createDefaultToolRegistry(contract.fixtureRoot);
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

export async function runEval(options: EvalOptions): Promise<EvalResult> {
  const contract = loadSkillContract(options.skillName);
  const testCases = loadTestCases(options.skillName);
  if (testCases.length === 0) {
    throw new Error(`No test cases found for skill "${options.skillName}".`);
  }
  const adapter = await createAdapter(options.modelName);

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
      runs.push(
        await runAttempt({
          adapter,
          contract,
          testCase,
          attemptIndex: attempt,
          rootLogger,
          modelName: options.modelName,
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
