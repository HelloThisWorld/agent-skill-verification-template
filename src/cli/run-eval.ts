import { Command } from "commander";
import { runEval } from "../core/eval-runner.js";
import { DEFAULT_RUNS_PER_CASE, DEFAULT_THRESHOLD } from "../core/thresholds.js";
import { SUPPORTED_MODELS } from "../models/model-adapter.js";
import type { EvalSummary } from "../reporting/summary-json.js";
import { writeEvalReports, type WrittenReports } from "../reporting/write-reports.js";

/**
 * CLI entry point.
 *
 * Default invocation (`npm run eval`) runs fully offline with the mock adapter,
 * writes the report bundle to reports/latest, prints a concise terminal summary,
 * and exits non-zero when the release gate fails (unless `--no-gate`).
 */

interface CliOptions {
  skill: string;
  model: string;
  runs: string;
  threshold: string;
  output: string;
  gate: boolean;
}

function pct(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function printSummary(summary: EvalSummary, written: WrittenReports): void {
  const m = summary.metrics;
  const useColor = Boolean(process.stdout.isTTY);
  const green = (s: string): string => (useColor ? `\x1b[32m${s}\x1b[0m` : s);
  const red = (s: string): string => (useColor ? `\x1b[31m${s}\x1b[0m` : s);
  const result = summary.result === "PASSED" ? green("PASSED") : red("FAILED");

  const row = (label: string, value: string): string => `  ${label.padEnd(23)}${value}`;
  const lines = [
    "",
    "==================== Eval Summary ====================",
    row("Skill:", `${summary.skill.name} v${summary.skill.version}`),
    row("Model:", `${summary.model.name} (${summary.model.type})`),
    row("Test cases:", String(summary.totals.testCases)),
    row("Runs per case:", String(summary.config.runsPerCase)),
    row("Total runs:", String(summary.totals.totalRuns)),
    row("Pass rate:", pct(m.passRate)),
    row("Schema valid rate:", pct(m.schemaValidRate)),
    row("Citation valid rate:", pct(m.citationValidRate)),
    row("Unsupported claim rate:", pct(m.unsupportedClaimRate)),
    row("Tool error rate:", pct(m.toolErrorRate)),
    row("P95 latency:", `${m.latencyMsP95} ms (estimated)`),
    row("Result:", result),
    row("Report:", `${summary.config.outputDir}/report.html`),
  ];

  if (summary.result === "FAILED" && summary.gateReasons.length > 0) {
    lines.push(row("Gate:", summary.gateReasons.join("; ")));
  }
  if (written.artifactPaths.length > 0) {
    lines.push(
      row("Replay artifacts:", `${written.artifactPaths.length} in ${summary.config.outputDir}/replay-artifacts/`),
    );
  }
  lines.push("======================================================", "");
  console.log(lines.join("\n"));
}

async function main(): Promise<void> {
  const program = new Command();
  program
    .name("run-eval")
    .description("Run the agent skill verification eval harness (offline by default).")
    .option("--skill <name>", "skill to evaluate", "codebase-understanding")
    .option("--model <name>", `model adapter: ${SUPPORTED_MODELS.join(" | ")}`, "mock")
    .option("--runs <n>", "runs per test case", String(DEFAULT_RUNS_PER_CASE))
    .option("--threshold <n>", "release-gate pass-rate threshold (0..1)", String(DEFAULT_THRESHOLD))
    .option("--output <dir>", "report output directory", "reports/latest")
    .option("--no-gate", "do not exit non-zero when the release gate fails")
    .parse(process.argv);

  const opts = program.opts<CliOptions>();

  const runsPerCase = Number.parseInt(opts.runs, 10);
  const threshold = Number.parseFloat(opts.threshold);
  if (!Number.isFinite(runsPerCase) || runsPerCase < 1) {
    throw new Error(`--runs must be a positive integer (got "${opts.runs}").`);
  }
  if (!Number.isFinite(threshold) || threshold < 0 || threshold > 1) {
    throw new Error(`--threshold must be a number between 0 and 1 (got "${opts.threshold}").`);
  }

  console.log(
    `Running eval — skill=${opts.skill} model=${opts.model} runs=${runsPerCase} threshold=${threshold}`,
  );

  const result = await runEval({
    skillName: opts.skill,
    modelName: opts.model,
    runsPerCase,
    threshold,
    outputDir: opts.output,
  });

  const written = writeEvalReports({
    outputDir: opts.output,
    summary: result.summary,
    runs: result.runs,
    logJsonl: result.logJsonl,
  });

  printSummary(result.summary, written);

  if (opts.gate && result.summary.result === "FAILED") {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(`\nEval failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
