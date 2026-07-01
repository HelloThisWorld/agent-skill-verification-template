import { existsSync, readFileSync, rmSync } from "node:fs";
import { afterAll, describe, expect, it } from "vitest";
import { resolveFromRoot } from "../src/core/paths.js";
import { runEval } from "../src/core/eval-runner.js";
import { buildHtmlReport } from "../src/reporting/html-report.js";
import { toPrometheus } from "../src/reporting/prometheus-export.js";
import { summaryToJson } from "../src/reporting/summary-json.js";
import { writeEvalReports } from "../src/reporting/write-reports.js";

const OUT = "reports/__test__";

describe("report generation", () => {
  afterAll(() => rmSync(resolveFromRoot(OUT), { recursive: true, force: true }));

  it("renders HTML, Prometheus, and JSON from a summary", async () => {
    const result = await runEval({
      skillName: "codebase-understanding",
      modelName: "mock",
      runsPerCase: 2,
      threshold: 0.9,
      outputDir: OUT,
    });

    const html = buildHtmlReport(result.summary);
    expect(html).toContain("Agent Skill Verification Report");
    expect(html).toContain("PASSED");
    expect(html.trimStart().startsWith("<!doctype html>")).toBe(true);

    const prom = toPrometheus(result.summary);
    expect(prom).toContain("skill_pass_rate");
    expect(prom).toMatch(/skill_run_total\{[^}]*\} 14/);

    const json = JSON.parse(summaryToJson(result.summary));
    expect(json.skill.name).toBe("codebase-understanding");
    expect(json.result).toBe("PASSED");
  });

  it("writes the full report bundle and replay artifacts to disk", async () => {
    const result = await runEval({
      skillName: "codebase-understanding",
      modelName: "mock-flaky",
      runsPerCase: 3,
      threshold: 0.9,
      outputDir: OUT,
    });

    const written = writeEvalReports({
      outputDir: OUT,
      summary: result.summary,
      runs: result.runs,
      logJsonl: result.logJsonl,
    });

    expect(existsSync(written.reportPath)).toBe(true);
    expect(existsSync(written.summaryPath)).toBe(true);
    expect(existsSync(written.metricsPath)).toBe(true);
    expect(existsSync(written.eventsPath)).toBe(true);
    expect(written.artifactPaths.length).toBeGreaterThan(0);

    // Replay artifacts are complete and contain no secrets.
    const artifact = JSON.parse(readFileSync(written.artifactPaths[0], "utf8"));
    expect(artifact.runId).toBeTruthy();
    expect(artifact.failureReasons.length).toBeGreaterThan(0);
    const serialized = JSON.stringify(artifact);
    expect(serialized).not.toMatch(/api[_-]?key/i);
    expect(serialized).not.toContain("password");
  });
});
