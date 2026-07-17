import { resolve } from "node:path";
import { loadCasesFile } from "./case-loader.js";
import {
  AdapterUnavailableError,
  VerificationRuntimeError,
  VerifierError,
  errorMessage,
} from "./errors.js";
import { runEvalCases, type EvalResult } from "./eval-runner.js";
import { loadSkillContractFromDir } from "./skill-contract.js";
import { repoRoot, toRepoRelativePosix } from "./paths.js";
import { toolVersion } from "./version.js";
import { createAdapter, SUPPORTED_MODELS } from "../models/model-adapter.js";
import {
  writeVerificationOutputs,
  type OutputFormat,
  type VerificationOutputs,
} from "../reporting/write-verification-outputs.js";

/**
 * Reusable verification service — the core API behind `agent-skill-verifier
 * verify`. It has no terminal formatting and returns structured results, so it
 * can be embedded in tests or other tooling directly.
 */

export interface VerifyServiceOptions {
  /** Path to the skill directory containing skill-contract.json. */
  skillPath: string;
  /** Path to the evaluation cases file (JSON or YAML). */
  casesPath: string;
  adapter: string;
  runsPerCase: number;
  threshold: number;
  seed?: number;
  /** Overall wall-clock budget for all runs, in milliseconds. */
  timeoutMs?: number;
  outputDir: string;
  formats: OutputFormat[];
  /** Fraction 0..1; when set, a higher flaky-case rate fails the gate. */
  maximumFlakyRate?: number;
}

export interface VerifyServiceResult {
  outputs: VerificationOutputs;
  eval: EvalResult;
  /** True when the quality gate passed. */
  gatePassed: boolean;
}

/** Create a model adapter, mapping unknown/unavailable adapters to exit code 3. */
export async function createAdapterChecked(name: string) {
  try {
    return await createAdapter(name);
  } catch (error) {
    throw new AdapterUnavailableError(errorMessage(error));
  }
}

export function isKnownAdapter(name: string): boolean {
  return (SUPPORTED_MODELS as readonly string[]).includes(name);
}

export async function verifySkill(options: VerifyServiceOptions): Promise<VerifyServiceResult> {
  const root = repoRoot();
  const skillDirAbs = resolve(root, options.skillPath);
  const casesAbs = resolve(root, options.casesPath);

  const contract = loadSkillContractFromDir(skillDirAbs);
  const testCases = loadCasesFile(casesAbs);
  const adapter = await createAdapterChecked(options.adapter);

  const deadlineMs = options.timeoutMs !== undefined ? Date.now() + options.timeoutMs : undefined;

  let evalResult: EvalResult;
  try {
    evalResult = await runEvalCases({
      contract,
      testCases,
      adapter,
      modelName: options.adapter,
      runsPerCase: options.runsPerCase,
      threshold: options.threshold,
      outputDir: options.outputDir,
      seed: options.seed,
      deadlineMs,
    });
  } catch (error) {
    if (error instanceof VerifierError) throw error;
    throw new VerificationRuntimeError(`Verification run failed: ${errorMessage(error)}`);
  }

  // Optional flaky-rate gate on top of the pass-rate gate.
  if (options.maximumFlakyRate !== undefined && evalResult.summary.perCase.length > 0) {
    const flaky = evalResult.summary.perCase.filter(
      (c) => c.passed > 0 && c.failureCount > 0,
    ).length;
    const flakyRate = flaky / evalResult.summary.perCase.length;
    if (flakyRate > options.maximumFlakyRate) {
      evalResult.summary.result = "FAILED";
      evalResult.summary.gateReasons.push(
        `flaky-case rate ${(flakyRate * 100).toFixed(1)}% exceeds the allowed maximum ` +
          `${(options.maximumFlakyRate * 100).toFixed(1)}%`,
      );
    }
  }

  const outputs = writeVerificationOutputs({
    outputDir: options.outputDir,
    summary: evalResult.summary,
    runs: evalResult.runs,
    logJsonl: evalResult.logJsonl,
    formats: options.formats,
    canonicalBase: {
      toolVersion: toolVersion(),
      skillPath: toRepoRelativePosix(skillDirAbs),
      casesPath: toRepoRelativePosix(casesAbs),
      adapter: options.adapter,
      seed: options.seed ?? null,
    },
    createdAt: new Date().toISOString(),
  });

  return {
    outputs,
    eval: evalResult,
    gatePassed: evalResult.summary.result === "PASSED",
  };
}
