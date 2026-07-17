import { resolve } from "node:path";
import { z } from "zod";
import { readStructuredFile } from "../../core/case-loader.js";
import { InputError } from "../../core/errors.js";
import { repoRoot } from "../../core/paths.js";
import { bold, colorEnabled, dim, green, red, type CliIo } from "../io.js";

/**
 * `agent-skill-verifier replay` — inspect a stored replay artifact.
 *
 * This is ARTIFACT INSPECTION, not model re-execution: the artifact already
 * contains the exact input, output, tool trace, and validation verdict of the
 * recorded run, so a failure can be understood without calling any model. The
 * artifact is validated against its schema and never mutated.
 */

export const replayArtifactSchema = z
  .object({
    runId: z.string().min(1),
    traceId: z.string().min(1),
    skillName: z.string().min(1),
    skillVersion: z.string(),
    modelName: z.string(),
    modelType: z.string(),
    testCaseId: z.string().min(1),
    attemptIndex: z.number().int().nonnegative(),
    input: z.unknown(),
    normalizedInput: z.unknown(),
    modelOutput: z.string(),
    parsedOutput: z.unknown(),
    toolCalls: z.unknown(),
    validationResult: z.object({
      passed: z.boolean(),
      failureReasons: z.array(z.string()),
      validators: z.array(
        z.object({
          validator: z.string(),
          passed: z.boolean(),
          reasons: z.array(z.string()),
        }),
      ),
    }),
    failureReasons: z.array(z.string()),
    timestamps: z.object({ startedAt: z.string(), endedAt: z.string() }),
    skillContractVersion: z.string(),
    promptVersion: z.string(),
    toolSchemaVersion: z.string(),
    modelConfig: z.record(z.unknown()),
    spans: z.unknown(),
  })
  .passthrough();

export type ReplayArtifactDocument = z.infer<typeof replayArtifactSchema>;

export interface ReplayCliOptions {
  json?: boolean;
  quiet?: boolean;
}

export function loadReplayArtifact(path: string): ReplayArtifactDocument {
  const abs = resolve(repoRoot(), path);
  const raw = readStructuredFile(abs, "Replay artifact");
  const parsed = replayArtifactSchema.safeParse(raw);
  if (!parsed.success) {
    throw new InputError(`Invalid replay artifact at ${abs}:\n${parsed.error.toString()}`);
  }
  return parsed.data;
}

export function runReplayCommand(io: CliIo, artifactPath: string, opts: ReplayCliOptions): number {
  const artifact = loadReplayArtifact(artifactPath);

  if (opts.json) {
    io.out(JSON.stringify(artifact, null, 2));
    return 0;
  }

  const color = colorEnabled({ json: false });
  const verdict = artifact.validationResult.passed ? green(color, "PASSED") : red(color, "FAILED");
  const lines: string[] = [
    bold(color, `Replay artifact — run ${artifact.runId}`),
    dim(color, "(stored-run inspection; no model is invoked and the artifact is not modified)"),
    "",
    `  Skill:        ${artifact.skillName} v${artifact.skillVersion}`,
    `  Adapter:      ${artifact.modelName} (${artifact.modelType})`,
    `  Case:         ${artifact.testCaseId} (attempt ${artifact.attemptIndex + 1})`,
    `  Started:      ${artifact.timestamps.startedAt}`,
    `  Ended:        ${artifact.timestamps.endedAt}`,
    `  Verdict:      ${verdict}`,
  ];

  const input = artifact.input as { question?: unknown } | null;
  if (input && typeof input === "object" && typeof input.question === "string") {
    lines.push(`  Question:     ${input.question}`);
  }

  const output = artifact.parsedOutput as { status?: unknown; answer?: unknown } | null;
  if (output && typeof output === "object") {
    if (typeof output.status === "string") lines.push(`  Output state: ${output.status}`);
    if (typeof output.answer === "string") lines.push(`  Answer:       ${output.answer}`);
  }

  if (!opts.quiet) {
    lines.push("", bold(color, "  Validators:"));
    for (const v of artifact.validationResult.validators) {
      const tag = v.passed ? green(color, "pass") : red(color, "FAIL");
      lines.push(`    ${tag}  ${v.validator}${v.reasons.length > 0 ? ` — ${v.reasons.join("; ")}` : ""}`);
    }
    const calls = Array.isArray(artifact.toolCalls) ? artifact.toolCalls : [];
    lines.push("", bold(color, `  Tool calls (${calls.length}):`));
    for (const call of calls as { tool?: unknown; ok?: unknown; resultSummary?: unknown }[]) {
      const status = call.ok === false ? red(color, "error") : "ok";
      lines.push(`    ${String(call.tool ?? "?")} [${status}] ${String(call.resultSummary ?? "")}`);
    }
  }

  if (artifact.failureReasons.length > 0) {
    lines.push("", bold(color, "  Failure reasons:"));
    for (const reason of artifact.failureReasons) lines.push(`    - ${reason}`);
  }

  io.out(lines.join("\n"));
  return 0;
}
