import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { runEval } from "../src/core/eval-runner.js";
import { resolveFromRoot } from "../src/core/paths.js";
import { parseTerm } from "../src/models/glossary-adapter.js";
import { wikipediaSearchTool } from "../src/tools/wikipedia-search-tool.js";
import { wikipediaFetchTool } from "../src/tools/wikipedia-fetch-tool.js";
import { parseSnapshot } from "../src/skills/glossary/snapshot.js";
import { renderGlossaryCard } from "../src/skills/glossary/render.js";

const toolCtx = { fixtureRoot: "fixtures/wikipedia" };
const base = { skillName: "glossary", threshold: 0.9, outputDir: "reports/__unused__" };

describe("glossary — parseTerm", () => {
  it("extracts the term from a 'glossary <term>' request", () => {
    expect(parseTerm("glossary Mexico")).toBe("Mexico");
    expect(parseTerm("glossary: Switzerland")).toBe("Switzerland");
    expect(parseTerm("  glossary   Japan ")).toBe("Japan");
    expect(parseTerm("glossary United States")).toBe("United States");
    expect(parseTerm("Canada")).toBe("Canada");
  });
});

describe("glossary — wikipedia tools", () => {
  it("search returns the exact article first for a cached term", () => {
    const r = wikipediaSearchTool.execute({ query: "Mexico" }, toolCtx);
    expect(r.files[0]).toBe("fixtures/wikipedia/Mexico.html");
    expect(r.matches.length).toBeGreaterThan(0);
  });

  it("search ranks the exact article above pages that merely mention the term", () => {
    // "Ivory Coast" also appears in neighbouring countries' extracts (e.g. Ghana).
    const r = wikipediaSearchTool.execute({ query: "Ivory Coast" }, toolCtx);
    expect(r.files[0]).toBe("fixtures/wikipedia/Ivory Coast.html");
  });

  it("search returns nothing for an uncached term", () => {
    const r = wikipediaSearchTool.execute({ query: "Wakanda" }, toolCtx);
    expect(r.files.length).toBe(0);
    expect(r.matches.length).toBe(0);
  });

  it("fetch returns structured data and a lede line that contains the query verbatim", () => {
    // Multi-word term: the lede must carry the exact query string.
    const r = wikipediaFetchTool.execute(
      { path: "fixtures/wikipedia/Bosnia and Herzegovina.html" },
      toolCtx,
    );
    expect(r.title).toBe("Bosnia and Herzegovina");
    expect(r.ledeLine).toBeGreaterThan(0);
    const lines = readFileSync(resolveFromRoot(r.path), "utf8").split(/\r?\n/);
    expect(lines[r.ledeLine - 1]).toContain("Bosnia and Herzegovina");
  });
});

describe("glossary — snapshot + renderer", () => {
  it("parses embedded data and renders a self-contained web page", () => {
    const html = readFileSync(resolveFromRoot("fixtures/wikipedia/Switzerland.html"), "utf8");
    const parsed = parseSnapshot(html);
    if (!parsed) throw new Error("snapshot did not parse");
    const card = renderGlossaryCard(parsed.data, {
      citationFile: "fixtures/wikipedia/Switzerland.html",
      citationLine: parsed.ledeLine,
      passRate: 1,
      result: "PASSED",
      runs: 10,
    });
    expect(card).toContain("<!doctype html>");
    expect(card).toContain("Switzerland");
    expect(card).toContain("PASSED");
    expect(card).toContain("fixtures/wikipedia/Switzerland.html");
  });
});

describe("glossary eval — reference adapter", () => {
  it("passes every case deterministically with grounded citations", async () => {
    const result = await runEval({ ...base, modelName: "glossary", runsPerCase: 2 });

    expect(result.summary.result).toBe("PASSED");
    expect(result.summary.metrics.passRate).toBe(1);
    expect(result.runs.every((r) => r.validation.passed)).toBe(true);

    const answered = result.runs.filter((r) => r.output.status === "answered");
    expect(answered.length).toBeGreaterThan(0);
    for (const run of answered) {
      expect(run.output.claims.length).toBeGreaterThan(0);
      for (const claim of run.output.claims) {
        expect(claim.citations.length).toBeGreaterThan(0);
      }
    }

    // Uncached (fictional) terms must decline rather than invent an answer.
    const negatives = result.runs.filter((r) => r.testCaseId.startsWith("gl_neg_"));
    expect(negatives.length).toBeGreaterThan(0);
    expect(negatives.every((r) => r.output.status === "insufficient_evidence")).toBe(true);
  });

  it("flaky adapter produces a deterministic mix of failures", async () => {
    const a = await runEval({ ...base, modelName: "glossary-flaky", runsPerCase: 5 });
    const b = await runEval({ ...base, modelName: "glossary-flaky", runsPerCase: 5 });

    expect(a.summary.result).toBe("FAILED");
    expect(a.summary.metrics.passRate).toBeGreaterThan(0);
    expect(a.summary.metrics.passRate).toBeLessThan(1);
    expect(a.summary.failureBreakdown.length).toBeGreaterThan(0);
    expect(a.summary.totals.passedRuns).toBe(b.summary.totals.passedRuns);
  });
});
