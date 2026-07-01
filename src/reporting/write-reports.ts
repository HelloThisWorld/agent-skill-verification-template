import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join, sep } from "node:path";
import { repoRoot, resolveFromRoot } from "../core/paths.js";
import type { RunResult } from "../core/types.js";
import { buildReplayArtifact } from "../artifacts/replay-artifact.js";
import { buildHtmlReport } from "./html-report.js";
import { toPrometheus } from "./prometheus-export.js";
import { summaryToJson, type EvalSummary } from "./summary-json.js";

/**
 * Writes the full report bundle to `outputDir`:
 *   summary.json, report.html, metrics.prom, structured-events.jsonl,
 *   and one replay-artifacts/<runId>.json per failed run.
 *
 * The output directory is wiped first so stale files never linger between runs.
 */

export interface WriteReportsInput {
  /** Repo-relative output directory, e.g. `reports/latest`. */
  outputDir: string;
  summary: EvalSummary;
  runs: RunResult[];
  logJsonl: string;
}

export interface WrittenReports {
  outputDir: string;
  summaryPath: string;
  reportPath: string;
  metricsPath: string;
  eventsPath: string;
  artifactPaths: string[];
}

export function writeEvalReports(input: WriteReportsInput): WrittenReports {
  const absOut = resolveFromRoot(input.outputDir);

  // Safety guard: never wipe the repo root or anything outside it.
  const root = repoRoot();
  if (absOut === root || !absOut.startsWith(root + sep)) {
    throw new Error(`Refusing to write reports to unsafe output path: ${absOut}`);
  }

  rmSync(absOut, { recursive: true, force: true });
  mkdirSync(join(absOut, "replay-artifacts"), { recursive: true });

  const summaryPath = join(absOut, "summary.json");
  const reportPath = join(absOut, "report.html");
  const metricsPath = join(absOut, "metrics.prom");
  const eventsPath = join(absOut, "structured-events.jsonl");

  writeFileSync(summaryPath, summaryToJson(input.summary), "utf8");
  writeFileSync(reportPath, buildHtmlReport(input.summary), "utf8");
  writeFileSync(metricsPath, toPrometheus(input.summary), "utf8");
  writeFileSync(eventsPath, input.logJsonl, "utf8");

  const artifactPaths: string[] = [];
  for (const run of input.runs) {
    if (run.validation.passed) continue;
    const artifact = buildReplayArtifact(run);
    const artifactPath = join(absOut, "replay-artifacts", `${run.runId}.json`);
    writeFileSync(artifactPath, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
    artifactPaths.push(artifactPath);
  }

  return { outputDir: input.outputDir, summaryPath, reportPath, metricsPath, eventsPath, artifactPaths };
}
