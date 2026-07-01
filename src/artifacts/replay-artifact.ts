import type { RunResult } from "../core/types.js";

/**
 * Replay artifact — a self-contained record of a single (failed) run.
 *
 * The goal is that a failure can be understood and re-examined without re-running
 * anything: it captures the exact input, the raw and parsed model output, the
 * tool trace, the validation result, and all version/config metadata. It contains
 * ONLY fixture data — no secrets and no real user data.
 */
export interface ReplayArtifact {
  runId: string;
  traceId: string;
  skillName: string;
  skillVersion: string;
  modelName: string;
  modelType: string;
  testCaseId: string;
  attemptIndex: number;
  input: unknown;
  normalizedInput: unknown;
  /** Raw model output as returned (serialized), before parsing. */
  modelOutput: string;
  /** Parsed/typed output the validators inspected. */
  parsedOutput: unknown;
  toolCalls: unknown;
  validationResult: unknown;
  failureReasons: string[];
  timestamps: { startedAt: string; endedAt: string };
  skillContractVersion: string;
  promptVersion: string;
  toolSchemaVersion: string;
  /** Model configuration. No secrets — deterministic seed only. */
  modelConfig: Record<string, unknown>;
  spans: unknown;
}

/** Relative path (from the report root) where a run's artifact is written. */
export function replayArtifactPath(runId: string): string {
  return `replay-artifacts/${runId}.json`;
}

export function buildReplayArtifact(run: RunResult): ReplayArtifact {
  return {
    runId: run.runId,
    traceId: run.traceId,
    skillName: run.skillName,
    skillVersion: run.skillVersion,
    modelName: run.modelName,
    modelType: run.modelType,
    testCaseId: run.testCaseId,
    attemptIndex: run.attemptIndex,
    input: run.input,
    normalizedInput: run.normalizedInput,
    modelOutput: JSON.stringify(run.output),
    parsedOutput: run.output,
    toolCalls: run.toolCalls,
    validationResult: run.validation,
    failureReasons: run.validation.failureReasons,
    timestamps: { startedAt: run.startedAt, endedAt: run.endedAt },
    skillContractVersion: run.versions.skillContractVersion,
    promptVersion: run.versions.promptVersion,
    toolSchemaVersion: run.versions.toolSchemaVersion,
    modelConfig: {
      name: run.modelName,
      type: run.modelType,
      seed: `${run.testCaseId}#${run.attemptIndex}`,
      deterministic: true,
      note: "Offline mock adapter; no sampling parameters and no secrets.",
    },
    spans: run.spans,
  };
}
