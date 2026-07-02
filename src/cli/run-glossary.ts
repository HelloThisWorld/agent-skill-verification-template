import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, sep } from "node:path";
import { Command } from "commander";
import { runEval } from "../core/eval-runner.js";
import { repoRoot, resolveFromRoot } from "../core/paths.js";
import { DEFAULT_RUNS_PER_CASE, DEFAULT_THRESHOLD } from "../core/thresholds.js";
import type { EvalSummary, PerCaseSummary } from "../reporting/summary-json.js";
import { writeEvalReports } from "../reporting/write-reports.js";
import { parseSnapshot } from "../skills/glossary/snapshot.js";
import {
  renderGlossaryCard,
  renderGlossaryIndex,
  type GlossaryIndexEntry,
} from "../skills/glossary/render.js";

/**
 * Glossary CLI: run the verification eval for the `glossary` skill and then
 * render the web-page deliverable (one HTML page per term + an index) from the
 * same grounded snapshots. Default invocation runs fully offline against the
 * fixture cache produced by `npm run glossary:build-cache`.
 */

interface CliOptions {
  model: string;
  runs: string;
  threshold: string;
  output: string;
  gate: boolean;
}

interface IndexEntry {
  query: string;
  title: string;
  file: string;
  url: string;
  description: string;
}

function pct(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

/** Render `<outputDir>/glossary/<term>.html` for every cached term + an index. */
function writeDeliverables(outputDir: string, summary: EvalSummary): number {
  const absOut = resolveFromRoot(outputDir);
  const root = repoRoot();
  if (absOut === root || !absOut.startsWith(root + sep)) {
    throw new Error(`Refusing to write deliverables to unsafe path: ${absOut}`);
  }
  const glossaryDir = join(absOut, "glossary");
  mkdirSync(glossaryDir, { recursive: true });

  const index = JSON.parse(
    readFileSync(resolveFromRoot("fixtures/wikipedia/index.json"), "utf8"),
  ) as { entries: IndexEntry[] };

  const perCaseById = new Map<string, PerCaseSummary>();
  for (const c of summary.perCase) perCaseById.set(c.id, c);

  const indexEntries: GlossaryIndexEntry[] = [];
  for (const entry of index.entries) {
    const html = readFileSync(resolveFromRoot(entry.file), "utf8");
    const parsed = parseSnapshot(html);
    if (!parsed) continue;

    // Test case ids replace spaces with underscores (see gen-glossary-testcases.mjs).
    const grade = perCaseById.get(`gl_${entry.query.replace(/\s+/g, "_")}`);
    const pageName = `${entry.query}.html`;
    const card = renderGlossaryCard(parsed.data, {
      citationFile: entry.file,
      citationLine: parsed.ledeLine,
      passRate: grade?.passRate ?? 0,
      result: grade?.result ?? "FAILED",
      runs: grade?.runs ?? 0,
    });
    writeFileSync(join(glossaryDir, pageName), card, "utf8");

    indexEntries.push({
      query: entry.query,
      title: entry.title,
      page: pageName,
      description: entry.description,
      passRate: grade?.passRate ?? 0,
      result: grade?.result ?? "FAILED",
      runs: grade?.runs ?? 0,
    });
  }

  const indexHtml = renderGlossaryIndex({
    entries: indexEntries,
    skill: summary.skill.name,
    skillVersion: summary.skill.version,
    model: summary.model.name,
    generatedAt: summary.generatedAt,
    overallResult: summary.result,
    overallPassRate: summary.metrics.passRate,
    reportHref: "../report.html",
  });
  writeFileSync(join(glossaryDir, "index.html"), indexHtml, "utf8");

  return indexEntries.length;
}

async function main(): Promise<void> {
  const program = new Command();
  program
    .name("run-glossary")
    .description("Run the glossary skill eval and render the web-page deliverable (offline).")
    .option("--model <name>", "model adapter: glossary | glossary-flaky", "glossary")
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

  if (!existsSync(resolveFromRoot("fixtures/wikipedia/index.json"))) {
    throw new Error(
      "Missing offline snapshot cache. Run `npm run glossary:build-cache` first (requires network, once).",
    );
  }

  console.log(
    `Running glossary eval — model=${opts.model} runs=${runsPerCase} threshold=${threshold}`,
  );

  const result = await runEval({
    skillName: "glossary",
    modelName: opts.model,
    runsPerCase,
    threshold,
    outputDir: opts.output,
  });

  writeEvalReports({
    outputDir: opts.output,
    summary: result.summary,
    runs: result.runs,
    logJsonl: result.logJsonl,
  });

  const pages = writeDeliverables(opts.output, result.summary);

  const m = result.summary.metrics;
  const useColor = Boolean(process.stdout.isTTY);
  const green = (s: string): string => (useColor ? `\x1b[32m${s}\x1b[0m` : s);
  const red = (s: string): string => (useColor ? `\x1b[31m${s}\x1b[0m` : s);
  const resultLabel = result.summary.result === "PASSED" ? green("PASSED") : red("FAILED");
  const row = (label: string, value: string): string => `  ${label.padEnd(22)}${value}`;

  console.log(
    [
      "",
      "================= Glossary Eval Summary =================",
      row("Skill:", `${result.summary.skill.name} v${result.summary.skill.version}`),
      row("Model:", `${result.summary.model.name} (${result.summary.model.type})`),
      row("Test cases:", String(result.summary.totals.testCases)),
      row("Runs per case:", String(result.summary.config.runsPerCase)),
      row("Total runs:", String(result.summary.totals.totalRuns)),
      row("Pass rate:", pct(m.passRate)),
      row("Citation valid rate:", pct(m.citationValidRate)),
      row("Tool error rate:", pct(m.toolErrorRate)),
      row("Result:", resultLabel),
      row("Report:", `${opts.output}/report.html`),
      row("Web pages:", `${pages} pages in ${opts.output}/glossary/ (open index.html)`),
      "========================================================",
      "",
    ].join("\n"),
  );

  if (opts.gate && result.summary.result === "FAILED") {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(`\nGlossary eval failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
