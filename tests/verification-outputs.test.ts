import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { replayArtifactSchema } from "../src/cli/commands/replay.js";
import {
  canonicalToEvalSummary,
  parseCanonicalResult,
  type CanonicalResult,
} from "../src/core/canonical-result.js";
import { resolveFromRoot } from "../src/core/paths.js";
import { verifySkill, type VerifyServiceResult } from "../src/core/verification-service.js";
import { buildHtmlReport } from "../src/reporting/html-report.js";
import { buildJUnitXml } from "../src/reporting/junit-xml.js";
import {
  resolveOutputDir,
  sanitizeFileComponent,
} from "../src/reporting/write-verification-outputs.js";

/**
 * Output-bundle tests: JSON/JUnit/HTML/replay artifact validity, escaping of
 * hostile content, JSONL event integrity, and output-path boundaries.
 */

const TMP = "tmp/output-tests";

afterAll(() => {
  rmSync(resolveFromRoot(TMP), { recursive: true, force: true });
});

let cached: VerifyServiceResult | null = null;
async function verified(): Promise<VerifyServiceResult> {
  if (!cached) {
    cached = await verifySkill({
      skillPath: "fixtures/valid-skill",
      casesPath: "fixtures/evals.yaml",
      adapter: "mock-flaky",
      runsPerCase: 5,
      threshold: 0.9,
      seed: 7,
      formats: ["json", "junit", "html", "replay"],
      outputDir: `${TMP}/bundle`,
    });
  }
  return cached;
}

/** Minimal well-formedness check: every opened tag is closed in order. */
function assertBalancedXml(xml: string): void {
  const stack: string[] = [];
  const tagRe = /<(\/?)([A-Za-z][\w.-]*)((?:"[^"]*"|'[^']*'|[^"'>])*?)(\/?)>/g;
  let match: RegExpExecArray | null;
  while ((match = tagRe.exec(xml)) !== null) {
    const [, closing, name, , selfClosing] = match;
    if (selfClosing === "/") continue;
    if (closing === "/") {
      expect(stack.pop()).toBe(name);
    } else {
      stack.push(name);
    }
  }
  expect(stack).toEqual([]);
}

describe("output bundle", () => {
  it("writes every artifact and the canonical summary validates", async () => {
    const r = await verified();
    const dir = r.outputs.outputDirAbs;
    for (const f of ["summary.json", "junit.xml", "report.html", "events.jsonl", "metrics.json"]) {
      expect(existsSync(join(dir, f)), `${f} should exist`).toBe(true);
    }
    const doc = JSON.parse(readFileSync(join(dir, "summary.json"), "utf8"));
    const canonical = parseCanonicalResult(doc, "summary.json");
    expect(canonical.tool.name).toBe("agent-skill-verifier");
    expect(canonical.artifacts.junit).toBe("junit.xml");
  });

  it("writes one schema-valid replay artifact per run", async () => {
    const r = await verified();
    expect(r.outputs.replayPaths).toHaveLength(15); // 3 cases x 5 runs
    for (const p of r.outputs.replayPaths) {
      const doc = JSON.parse(readFileSync(p, "utf8"));
      const parsed = replayArtifactSchema.safeParse(doc);
      expect(parsed.success, `replay ${p} should validate`).toBe(true);
    }
  });

  it("events.jsonl contains only valid JSON events with timestamps", async () => {
    const r = await verified();
    const lines = readFileSync(r.outputs.eventsPath, "utf8").trim().split("\n");
    expect(lines.length).toBeGreaterThan(10);
    for (const line of lines) {
      const event = JSON.parse(line);
      expect(typeof event.event).toBe("string");
      expect(typeof event.timestamp).toBe("string");
    }
  });

  it("metrics.json is consistent with the canonical summary", async () => {
    const r = await verified();
    const metrics = JSON.parse(readFileSync(r.outputs.metricsPath, "utf8"));
    expect(metrics.metrics).toEqual(r.outputs.canonical.metrics);
    expect(metrics.skill).toBe("valid-skill");
  });

  it("junit.xml is well-formed and counts match the canonical result", async () => {
    const r = await verified();
    const xml = readFileSync(r.outputs.junitPath as string, "utf8");
    assertBalancedXml(xml);
    expect(xml).toContain(`tests="${r.outputs.canonical.caseResults.length}"`);
    const failedCases = r.outputs.canonical.caseResults.filter((c) => c.result === "failed").length;
    expect(xml).toContain(`failures="${failedCases}"`);
  });

  it("report.html is self-contained (no external scripts, styles, or images)", async () => {
    const r = await verified();
    const html = readFileSync(r.outputs.htmlPath as string, "utf8");
    expect(html).toContain("<style>");
    expect(html).not.toMatch(/<script[^>]+src=/i);
    expect(html).not.toMatch(/<link[^>]+href=/i);
    expect(html).not.toMatch(/<img[^>]+src=["']https?:/i);
  });
});

function hostileCanonical(): CanonicalResult {
  const r: CanonicalResult = {
    schemaVersion: "1.0.0",
    tool: { name: "agent-skill-verifier", version: "0.0.0-test" },
    skill: { name: `evil <script>alert("x")</script> & "skill"`, version: "1.0.0", path: "skills/evil" },
    configuration: { cases: "evals.yaml", runsPerCase: 1, threshold: 0.9, seed: null, adapter: "mock" },
    summary: {
      result: "failed",
      cases: 1,
      totalRuns: 1,
      passedRuns: 0,
      failedRuns: 1,
      passRate: 0,
      flakyCases: 0,
    },
    gate: { passed: false, reasons: [`pass rate <b>0%</b> & below 'threshold'`] },
    metrics: {
      latencyMs: { p50: 1, p95: 1, p99: 1, estimated: true },
      tokenUsage: { inputTotal: 1, outputTotal: 1, estimated: true },
      schemaValidRate: 0,
      structuredOutputRate: 0,
      citationValidityRate: 0,
      unsupportedClaimRate: 1,
      toolErrorRate: 0,
      estimatedCostUsd: 0,
      toolSelectionAccuracy: null,
      refusalAccuracy: null,
    },
    caseResults: [
      {
        id: `case <img src=x onerror=alert(1)>`,
        name: `name with </testcase> injection & "quotes"`,
        kind: "happy",
        expectedStatus: "answered",
        runs: 1,
        passedRuns: 0,
        failedRuns: 1,
        passRate: 0,
        citationValidRate: 0,
        minPassRate: 0.9,
        flaky: false,
        result: "failed",
      },
    ],
    failureBreakdown: [{ reason: `reason with <xml> & "entities"`, count: 1 }],
    failedRuns: [
      {
        runId: "run_x_0001",
        testCaseId: `case <img src=x onerror=alert(1)>`,
        failureReasons: [`reason with <xml> & "entities"`],
        replay: "replays/x.json",
      },
    ],
    notes: [],
    artifacts: {
      summary: "summary.json",
      junit: "junit.xml",
      html: "report.html",
      events: "events.jsonl",
      metrics: "metrics.json",
      replays: "replays",
    },
    createdAt: "2026-01-01T00:00:00.000Z",
  };
  return r;
}

describe("escaping", () => {
  it("HTML-escapes hostile skill and case content", () => {
    const html = buildHtmlReport(canonicalToEvalSummary(hostileCanonical()));
    expect(html).not.toContain(`<script>alert("x")</script>`);
    expect(html).not.toContain("<img src=x onerror=alert(1)>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("XML-escapes hostile case names and reasons in JUnit output", () => {
    const xml = buildJUnitXml(hostileCanonical());
    assertBalancedXml(xml);
    expect(xml).not.toContain(`with </testcase> injection`);
    expect(xml).toContain("&lt;/testcase&gt;");
    expect(xml).not.toContain(`<img src=x`);
  });
});

describe("output path safety", () => {
  it("rejects escaping the workspace and filesystem roots", () => {
    expect(() => resolveOutputDir("../outside")).toThrow(/inside the working directory/);
    expect(() => resolveOutputDir(join("..", "..", "escape"))).toThrow(/inside the working directory/);
  });

  it("sanitizes case ids used in replay file names", () => {
    expect(sanitizeFileComponent("../../etc/passwd")).toBe("etc-passwd");
    expect(sanitizeFileComponent("case:001 <hostile>")).toBe("case-001-hostile-");
    expect(sanitizeFileComponent("")).toBe("case");
  });
});
