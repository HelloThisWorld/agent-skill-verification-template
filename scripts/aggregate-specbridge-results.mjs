// Aggregate the 11 specbridge-* eval reports into one machine-readable
// rollup (specbridge-verification.json) and a Markdown summary table
// (specbridge-verification.md) under reports/.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const SKILLS = [
  "status", "doctor", "new", "author", "approve", "implement",
  "continue", "verify", "runners", "templates", "extensions",
];

const rows = [];
for (const name of SKILLS) {
  const summaryPath = path.join(root, "reports", `specbridge-${name}`, "summary.json");
  if (!existsSync(summaryPath)) {
    console.error(`missing: ${summaryPath}`);
    process.exit(1);
  }
  const summary = JSON.parse(readFileSync(summaryPath, "utf8"));
  rows.push({
    skill: name,
    harnessSkill: summary.skill,
    model: summary.config?.modelName ?? summary.model,
    cases: summary.totals?.cases ?? summary.perCase?.length,
    runs: summary.totals?.runs,
    passRate: summary.metrics?.passRate,
    schemaValidRate: summary.metrics?.schemaValidRate,
    citationValidRate: summary.metrics?.citationValidRate,
    p95LatencyMs: summary.metrics?.latency?.p95Ms ?? summary.metrics?.p95LatencyMs ?? null,
    result: summary.result,
    perCase: (summary.perCase ?? []).map((c) => ({ id: c.id ?? c.testCaseId, result: c.result, passRate: c.passRate })),
  });
}

const allPassed = rows.every((row) => row.result === "PASSED");
const rollup = {
  generatedBy: "agent-skill-verification-template scripts/aggregate-specbridge-results.mjs",
  subject: "SpecBridge v0.7.1 Claude Code plugin skills (11)",
  adapter: "llm (OpenAI-compatible, llama.cpp llama-server)",
  modelFile: "gemma-4-26B-A4B-it-UD-Q4_K_M.gguf",
  gate: { runsPerCase: 1, threshold: 0.8 },
  allPassed,
  skills: rows,
};
writeFileSync(path.join(root, "reports", "specbridge-verification.json"), `${JSON.stringify(rollup, null, 2)}\n`);

const pct = (x) => (typeof x === "number" ? `${Math.round(x * 100)}%` : "–");
const md = [
  "# SpecBridge plugin skill verification — results",
  "",
  "Every SpecBridge Claude Code plugin skill was evaluated with the",
  "[agent-skill-verification-template](https://github.com/HelloThisWorld/agent-skill-verification-template)",
  "harness against a REAL local model (llama.cpp `llama-server`,",
  "`gemma-4-26B-A4B-it-UD-Q4_K_M.gguf`, temperature 0) over a real SpecBridge",
  "fixture workspace. Tools shell out to the actual `specbridge` CLI",
  "(read-only commands only); answers must cite real `file:line` evidence that",
  "the harness re-reads from disk; mutation requests must be refused.",
  "",
  `Overall: **${allPassed ? "11/11 skills PASSED" : "FAILURES PRESENT"}** (gate: every case ≥ 80% pass rate, 1 run/case).`,
  "",
  "| Skill | Cases | Pass rate | Schema | Citations | P95 latency | Result |",
  "| --- | --- | --- | --- | --- | --- | --- |",
  ...rows.map((row) =>
    `| \`${row.skill}\` | ${row.cases} | ${pct(row.passRate)} | ${pct(row.schemaValidRate)} | ${pct(row.citationValidRate)} | ` +
    `${row.p95LatencyMs !== null ? `${(row.p95LatencyMs / 1000).toFixed(1)}s` : "–"} | ${row.result} |`),
  "",
  "Per-skill checks: answered cases must call the required SpecBridge tools,",
  "cite evidence lines carrying the expected symbols, and avoid forbidden",
  "claims; guard cases prove each skill refuses to create/approve/execute/",
  "enable/install anything (those stay explicit `specbridge` CLI actions).",
  "",
].join("\n");
writeFileSync(path.join(root, "reports", "specbridge-verification.md"), md);
console.log(`aggregated: allPassed=${allPassed}`);
