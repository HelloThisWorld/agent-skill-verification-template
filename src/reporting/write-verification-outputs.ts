import { existsSync, mkdirSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { isAbsolute, join, parse as parsePath, resolve } from "node:path";
import { buildReplayArtifact } from "../artifacts/replay-artifact.js";
import { ArtifactError, InputError, errorMessage } from "../core/errors.js";
import {
  buildCanonicalResult,
  canonicalResultSchema,
  type BuildCanonicalParams,
  type CanonicalResult,
} from "../core/canonical-result.js";
import { isInside, repoRoot } from "../core/paths.js";
import type { RunResult } from "../core/types.js";
import type { EvalSummary } from "./summary-json.js";
import { buildHtmlReport } from "./html-report.js";
import { buildJUnitXml } from "./junit-xml.js";

/**
 * Writes the CLI verification output bundle:
 *
 *   <output>/
 *   ├── summary.json     canonical verification result (schema-validated)
 *   ├── report.html      self-contained HTML report
 *   ├── junit.xml        JUnit report for CI systems
 *   ├── events.jsonl     structured event log
 *   ├── metrics.json     aggregate metrics document
 *   └── replays/         one replay artifact per run: <case>-run-<NN>.json
 *
 * Files are written atomically (temp file + rename). Only files this tool
 * generates are ever overwritten or cleaned; the directory itself is never
 * wiped wholesale.
 */

export type OutputFormat = "json" | "junit" | "html" | "replay";

export const ALL_OUTPUT_FORMATS: OutputFormat[] = ["json", "junit", "html", "replay"];

export interface WriteVerificationOutputsInput {
  /** Output directory (absolute, or relative to the workspace root). */
  outputDir: string;
  summary: EvalSummary;
  runs: RunResult[];
  logJsonl: string;
  formats: OutputFormat[];
  canonicalBase: Omit<BuildCanonicalParams, "summary" | "artifacts" | "replayFileByRunId" | "createdAt">;
  createdAt: string;
}

export interface VerificationOutputs {
  outputDirAbs: string;
  canonical: CanonicalResult;
  summaryPath: string;
  htmlPath: string | null;
  junitPath: string | null;
  eventsPath: string;
  metricsPath: string;
  replayPaths: string[];
}

/**
 * Resolve and guard the output directory: it must stay inside the workspace
 * root (the directory the CLI was invoked from), so a malicious or mistyped
 * configuration can never write outside the project.
 */
export function resolveOutputDir(outputDir: string): string {
  const root = repoRoot();
  const abs = isAbsolute(outputDir) ? resolve(outputDir) : resolve(root, outputDir);
  if (abs === parsePath(abs).root) {
    throw new InputError(`Refusing to use a filesystem root as the output directory: ${abs}`);
  }
  if (!isInside(root, abs)) {
    throw new InputError(
      `Output directory must stay inside the working directory (${root}); got: ${abs}`,
    );
  }
  return abs;
}

/** Make a case id safe to use as a file name component. */
export function sanitizeFileComponent(id: string): string {
  const cleaned = id.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^[.-]+/, "");
  return cleaned.length > 0 ? cleaned.slice(0, 80) : "case";
}

function writeFileAtomic(path: string, content: string): void {
  const tmp = `${path}.tmp-${process.pid}`;
  try {
    writeFileSync(tmp, content, "utf8");
    renameSync(tmp, path);
  } catch (error) {
    try {
      rmSync(tmp, { force: true });
    } catch {
      // best-effort temp cleanup
    }
    throw new ArtifactError(`Failed to write ${path}: ${errorMessage(error)}`);
  }
}

export function writeVerificationOutputs(input: WriteVerificationOutputsInput): VerificationOutputs {
  const outAbs = resolveOutputDir(input.outputDir);
  const replaysDir = join(outAbs, "replays");
  const wantReplays = input.formats.includes("replay");
  const wantJunit = input.formats.includes("junit");
  const wantHtml = input.formats.includes("html");

  try {
    mkdirSync(outAbs, { recursive: true });
    if (wantReplays) mkdirSync(replaysDir, { recursive: true });
  } catch (error) {
    throw new ArtifactError(`Failed to create output directory ${outAbs}: ${errorMessage(error)}`);
  }

  // Clean only previously generated replay artifacts (known *.json files).
  if (wantReplays && existsSync(replaysDir)) {
    for (const entry of readdirSync(replaysDir)) {
      if (entry.endsWith(".json")) rmSync(join(replaysDir, entry), { force: true });
    }
  }

  // Write replay artifacts for every run so any run can be inspected later.
  const replayPaths: string[] = [];
  const replayFileByRunId = new Map<string, string>();
  if (wantReplays) {
    const usedNames = new Set<string>();
    for (const run of input.runs) {
      const base = `${sanitizeFileComponent(run.testCaseId)}-run-${String(run.attemptIndex + 1).padStart(2, "0")}`;
      let candidate = `${base}.json`;
      let n = 2;
      while (usedNames.has(candidate)) {
        candidate = `${base}-${n}.json`;
        n += 1;
      }
      usedNames.add(candidate);
      const artifact = buildReplayArtifact(run);
      const absPath = join(replaysDir, candidate);
      writeFileAtomic(absPath, `${JSON.stringify(artifact, null, 2)}\n`);
      replayPaths.push(absPath);
      replayFileByRunId.set(run.runId, `replays/${candidate}`);
    }
  }

  const artifacts: CanonicalResult["artifacts"] = {
    summary: "summary.json",
    junit: wantJunit ? "junit.xml" : null,
    html: wantHtml ? "report.html" : null,
    events: "events.jsonl",
    metrics: "metrics.json",
    replays: wantReplays ? "replays" : null,
  };

  const canonical = buildCanonicalResult({
    ...input.canonicalBase,
    summary: input.summary,
    replayFileByRunId: wantReplays ? replayFileByRunId : null,
    artifacts,
    createdAt: input.createdAt,
  });

  // Validate before writing: an invalid canonical document is a bug, and we
  // never want CI to consume a malformed report.
  const validated = canonicalResultSchema.safeParse(canonical);
  if (!validated.success) {
    throw new ArtifactError(
      `Internal error: canonical result failed schema validation:\n${validated.error.toString()}`,
    );
  }

  const summaryPath = join(outAbs, "summary.json");
  writeFileAtomic(summaryPath, `${JSON.stringify(canonical, null, 2)}\n`);

  const eventsPath = join(outAbs, "events.jsonl");
  writeFileAtomic(eventsPath, input.logJsonl);

  const metricsPath = join(outAbs, "metrics.json");
  const metricsDoc = {
    schemaVersion: canonical.schemaVersion,
    skill: canonical.skill.name,
    adapter: canonical.configuration.adapter,
    metrics: canonical.metrics,
    createdAt: canonical.createdAt,
  };
  writeFileAtomic(metricsPath, `${JSON.stringify(metricsDoc, null, 2)}\n`);

  let junitPath: string | null = null;
  if (wantJunit) {
    junitPath = join(outAbs, "junit.xml");
    writeFileAtomic(junitPath, buildJUnitXml(canonical));
  }

  let htmlPath: string | null = null;
  if (wantHtml) {
    htmlPath = join(outAbs, "report.html");
    writeFileAtomic(htmlPath, buildHtmlReport(input.summary));
  }

  return {
    outputDirAbs: outAbs,
    canonical,
    summaryPath,
    htmlPath,
    junitPath,
    eventsPath,
    metricsPath,
    replayPaths,
  };
}
