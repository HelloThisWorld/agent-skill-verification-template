import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { runCli } from "../src/cli/program.js";
import type { CliIo } from "../src/cli/io.js";
import { resolveFromRoot } from "../src/core/paths.js";

/**
 * In-process CLI tests: the full command surface, the exit-code contract, and
 * output hygiene (no ANSI in JSON, NO_COLOR support). `runCli` is the same
 * function the packaged binary executes.
 */

const TMP = "tmp/cli-tests";

interface Captured {
  io: CliIo;
  out: string[];
  err: string[];
  all: () => string;
}

function capture(): Captured {
  const out: string[] = [];
  const err: string[] = [];
  return {
    io: { out: (t) => out.push(t), err: (t) => err.push(t) },
    out,
    err,
    all: () => [...out, ...err].join("\n"),
  };
}

const FIXTURE_ARGS = ["--skill", "fixtures/valid-skill", "--cases", "fixtures/evals.yaml"];

const ANSI_PATTERN = new RegExp(String.fromCharCode(27) + "\\[");

beforeEach(() => {
  delete process.env.NO_COLOR;
});

afterAll(() => {
  rmSync(resolveFromRoot(TMP), { recursive: true, force: true });
});

describe("informational commands", () => {
  it("--version prints the package version and exits 0", async () => {
    const c = capture();
    const code = await runCli(["--version"], c.io);
    expect(code).toBe(0);
    const pkg = JSON.parse(readFileSync(resolveFromRoot("package.json"), "utf8"));
    expect(c.out.join("")).toBe(pkg.version);
  });

  it("--help prints usage for every command and exits 0", async () => {
    const c = capture();
    const code = await runCli(["--help"], c.io);
    expect(code).toBe(0);
    for (const cmd of ["verify", "validate", "replay", "report"]) {
      expect(c.all()).toContain(cmd);
    }
  });

  it("no arguments prints help and exits 0", async () => {
    const c = capture();
    const code = await runCli([], c.io);
    expect(code).toBe(0);
    expect(c.all()).toContain("Usage:");
  });

  it("unknown command exits 2", async () => {
    const c = capture();
    expect(await runCli(["frobnicate"], c.io)).toBe(2);
  });

  it("unknown option exits 2", async () => {
    const c = capture();
    expect(await runCli(["verify", "--does-not-exist"], c.io)).toBe(2);
  });
});

describe("verify command", () => {
  it("passes the fixture skill and exits 0", async () => {
    const c = capture();
    const code = await runCli(
      ["verify", ...FIXTURE_ARGS, "--runs", "2", "--output", `${TMP}/verify-ok`],
      c.io,
    );
    expect(code).toBe(0);
    expect(c.all()).toContain("PASSED");
  });

  it("respects CI=true without prompting and exits cleanly", async () => {
    const prev = process.env.CI;
    process.env.CI = "true";
    try {
      const c = capture();
      const code = await runCli(
        ["verify", ...FIXTURE_ARGS, "--runs", "1", "--non-interactive", "--output", `${TMP}/verify-ci`],
        c.io,
      );
      expect(code).toBe(0);
      expect(c.all()).not.toMatch(ANSI_PATTERN);
    } finally {
      if (prev === undefined) delete process.env.CI;
      else process.env.CI = prev;
    }
  });

  it("emits pure JSON (parseable, no ANSI) with --json", async () => {
    const c = capture();
    const code = await runCli(
      ["verify", ...FIXTURE_ARGS, "--runs", "2", "--json", "--output", `${TMP}/verify-json`],
      c.io,
    );
    expect(code).toBe(0);
    const text = c.out.join("\n");
    expect(text).not.toMatch(ANSI_PATTERN);
    const doc = JSON.parse(text);
    expect(doc.schemaVersion).toBe("1.0.0");
    expect(doc.summary.result).toBe("passed");
  });

  it("exits 1 when the threshold gate fails and still prints the JSON result", async () => {
    const c = capture();
    const code = await runCli(
      [
        "verify",
        ...FIXTURE_ARGS,
        "--adapter",
        "mock-flaky",
        "--runs",
        "4",
        "--threshold",
        "1",
        "--json",
        "--output",
        `${TMP}/verify-gate-fail`,
      ],
      c.io,
    );
    expect(code).toBe(1);
    const doc = JSON.parse(c.out.join("\n"));
    expect(doc.summary.result).toBe("failed");
    expect(doc.gate.reasons.length).toBeGreaterThan(0);
  });

  it("exits 0 on gate failure with --no-fail-on-threshold", async () => {
    const c = capture();
    const code = await runCli(
      [
        "verify",
        ...FIXTURE_ARGS,
        "--adapter",
        "mock-flaky",
        "--runs",
        "4",
        "--threshold",
        "1",
        "--no-fail-on-threshold",
        "--quiet",
        "--output",
        `${TMP}/verify-no-gate`,
      ],
      c.io,
    );
    expect(code).toBe(0);
  });

  it("exits 2 for a missing skill path", async () => {
    const c = capture();
    expect(
      await runCli(["verify", "--cases", "fixtures/evals.yaml", "--output", `${TMP}/x`], c.io),
    ).toBe(2);
    expect(c.err.join("\n")).toContain("No skill specified");
  });

  it("exits 2 for missing cases", async () => {
    const c = capture();
    expect(
      await runCli(["verify", "--skill", "fixtures/valid-skill", "--output", `${TMP}/x`], c.io),
    ).toBe(2);
  });

  it("exits 2 for a nonexistent skill directory", async () => {
    const c = capture();
    expect(
      await runCli(
        ["verify", "--skill", "fixtures/does-not-exist", "--cases", "fixtures/evals.yaml"],
        c.io,
      ),
    ).toBe(2);
  });

  it.each([
    ["0", "--runs"],
    ["-3", "--runs"],
    ["abc", "--runs"],
    ["2.5", "--runs"],
  ])("exits 2 for invalid runs value %s", async (value) => {
    const c = capture();
    expect(await runCli(["verify", ...FIXTURE_ARGS, "--runs", value], c.io)).toBe(2);
  });

  it.each([
    ["1.5", "--threshold"],
    ["-0.1", "--threshold"],
    ["abc", "--threshold"],
  ])("exits 2 for invalid threshold value %s", async (value) => {
    const c = capture();
    expect(await runCli(["verify", ...FIXTURE_ARGS, "--threshold", value], c.io)).toBe(2);
  });

  it("exits 2 for conflicting options", async () => {
    const c = capture();
    expect(await runCli(["verify", ...FIXTURE_ARGS, "--quiet", "--verbose"], c.io)).toBe(2);
    expect(await runCli(["verify", ...FIXTURE_ARGS, "--json", "--format", "terminal"], c.io)).toBe(2);
  });

  it("exits 3 for an unknown adapter and reports a JSON error in json mode", async () => {
    const c = capture();
    const code = await runCli(
      ["verify", ...FIXTURE_ARGS, "--adapter", "no-such-adapter", "--json"],
      c.io,
    );
    expect(code).toBe(3);
    const doc = JSON.parse(c.out.join("\n"));
    expect(doc.error.kind).toBe("adapter-unavailable");
    expect(doc.error.exitCode).toBe(3);
  });

  it("exits 5 when the wall-clock budget is exhausted", async () => {
    const c = capture();
    const code = await runCli(
      [
        "verify",
        ...FIXTURE_ARGS,
        "--runs",
        "50",
        "--timeout-ms",
        "1",
        "--output",
        `${TMP}/verify-timeout`,
      ],
      c.io,
    );
    expect(code).toBe(5);
    expect(c.err.join("\n")).toContain("deadline");
  });

  it("rejects output directories outside the working directory", async () => {
    const c = capture();
    const code = await runCli(["verify", ...FIXTURE_ARGS, "--output", "../escape-attempt"], c.io);
    expect(code).toBe(2);
    expect(c.err.join("\n")).toContain("inside the working directory");
  });

  it("handles UTF-8 paths and paths containing spaces (native separators)", async () => {
    const dir = resolveFromRoot(`${TMP}/ütf-8 spaced dir`);
    mkdirSync(join(dir, "fixtures", "valid-skill", "corpus"), { recursive: true });
    for (const f of ["skill-contract.json"]) {
      writeFileSync(
        join(dir, "fixtures", "valid-skill", f),
        readFileSync(resolveFromRoot(`fixtures/valid-skill/${f}`)),
      );
    }
    for (const f of ["InvoiceService.ts", "PaymentGateway.ts", "README.md"]) {
      writeFileSync(
        join(dir, "fixtures", "valid-skill", "corpus", f),
        readFileSync(resolveFromRoot(`fixtures/valid-skill/corpus/${f}`)),
      );
    }
    writeFileSync(join(dir, "cases éval.yaml"), readFileSync(resolveFromRoot("fixtures/evals.yaml")));

    // Paths are workspace-relative with native separators (join covers Windows-style on win32).
    const rel = `${TMP}/ütf-8 spaced dir`;
    const c = capture();
    const code = await runCli(
      [
        "verify",
        "--skill",
        join(rel, "fixtures", "valid-skill"),
        "--cases",
        join(rel, "cases éval.yaml"),
        "--runs",
        "1",
        // Citations resolve against the workspace root, so run the copied corpus
        // through the copied contract only for loading; case citation checks use
        // the repo fixtures which do not exist under the temp root.
        "--threshold",
        "0",
        "--no-fail-on-threshold",
        "--quiet",
        "--output",
        `${TMP}/verify-utf8`,
      ],
      c.io,
    );
    expect(code).toBe(0);
  });
});

describe("validate command", () => {
  it("accepts the fixture skill and exits 0 without executing runs", async () => {
    const c = capture();
    const code = await runCli(["validate", ...FIXTURE_ARGS, "--json"], c.io);
    expect(code).toBe(0);
    const doc = JSON.parse(c.out.join("\n"));
    expect(doc.valid).toBe(true);
    expect(doc.findings.filter((f: { level: string }) => f.level === "error")).toHaveLength(0);
  });

  it("exits 2 for a malformed contract", async () => {
    const dir = resolveFromRoot(`${TMP}/bad-skill`);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "skill-contract.json"), JSON.stringify({ name: "broken" }));
    const c = capture();
    const code = await runCli(
      ["validate", "--skill", `${TMP}/bad-skill`, "--cases", "fixtures/evals.yaml", "--json"],
      c.io,
    );
    expect(code).toBe(2);
    const doc = JSON.parse(c.out.join("\n"));
    expect(doc.valid).toBe(false);
  });

  it("exits 2 for duplicate case ids", async () => {
    const casesPath = resolveFromRoot(`${TMP}/dup-cases.json`);
    mkdirSync(resolveFromRoot(TMP), { recursive: true });
    const base = {
      name: "n",
      input: { question: "q" },
      expectedStatus: "answered",
    };
    writeFileSync(casesPath, JSON.stringify([{ id: "case-1", ...base }, { id: "case-1", ...base }]));
    const c = capture();
    const code = await runCli(
      ["validate", "--skill", "fixtures/valid-skill", "--cases", `${TMP}/dup-cases.json`, "--json"],
      c.io,
    );
    expect(code).toBe(2);
    expect(c.out.join("\n")).toContain("Duplicate case id");
  });

  it("exits 2 for an unknown adapter name", async () => {
    const c = capture();
    const code = await runCli(["validate", ...FIXTURE_ARGS, "--adapter", "bogus", "--json"], c.io);
    expect(code).toBe(2);
  });
});

describe("replay command", () => {
  it("inspects an artifact produced by verify and never modifies it", async () => {
    const out = `${TMP}/replay-src`;
    await runCli(["verify", ...FIXTURE_ARGS, "--runs", "1", "--quiet", "--output", out], capture().io);
    const artifactPath = resolveFromRoot(`${out}/replays/case-001-run-01.json`);
    const before = readFileSync(artifactPath, "utf8");

    const c = capture();
    const code = await runCli(["replay", `${out}/replays/case-001-run-01.json`], c.io);
    expect(code).toBe(0);
    expect(c.out.join("\n")).toContain("no model is invoked");
    expect(c.out.join("\n")).toContain("case-001");
    expect(readFileSync(artifactPath, "utf8")).toBe(before);
  });

  it("supports --json and emits the validated artifact", async () => {
    const out = `${TMP}/replay-json`;
    await runCli(["verify", ...FIXTURE_ARGS, "--runs", "1", "--quiet", "--output", out], capture().io);
    const c = capture();
    const code = await runCli(["replay", `${out}/replays/case-002-run-01.json`, "--json"], c.io);
    expect(code).toBe(0);
    const doc = JSON.parse(c.out.join("\n"));
    expect(doc.testCaseId).toBe("case-002");
  });

  it("exits 2 for a schema-invalid artifact", async () => {
    mkdirSync(resolveFromRoot(TMP), { recursive: true });
    const bad = resolveFromRoot(`${TMP}/bad-artifact.json`);
    writeFileSync(bad, JSON.stringify({ runId: "x" }));
    const c = capture();
    expect(await runCli(["replay", `${TMP}/bad-artifact.json`], c.io)).toBe(2);
  });
});

describe("report command", () => {
  it("converts a canonical summary to junit and html without rerunning", async () => {
    const out = `${TMP}/report-src`;
    await runCli(["verify", ...FIXTURE_ARGS, "--runs", "1", "--quiet", "--output", out], capture().io);

    const junit = capture();
    expect(
      await runCli(
        ["report", "--input", `${out}/summary.json`, "--format", "junit", "--output", `${TMP}/converted.xml`],
        junit.io,
      ),
    ).toBe(0);
    const xml = readFileSync(resolveFromRoot(`${TMP}/converted.xml`), "utf8");
    expect(xml).toContain("<testsuites");

    const html = capture();
    expect(
      await runCli(
        ["report", "--input", `${out}/summary.json`, "--format", "html", "--output", `${TMP}/converted.html`],
        html.io,
      ),
    ).toBe(0);
    expect(readFileSync(resolveFromRoot(`${TMP}/converted.html`), "utf8")).toContain("<!doctype html>");
  });

  it("exits 2 when --input is missing or invalid", async () => {
    expect(await runCli(["report"], capture().io)).toBe(2);
    mkdirSync(resolveFromRoot(TMP), { recursive: true });
    writeFileSync(resolveFromRoot(`${TMP}/not-canonical.json`), JSON.stringify({ nope: true }));
    expect(
      await runCli(["report", "--input", `${TMP}/not-canonical.json`], capture().io),
    ).toBe(2);
  });
});

describe("color handling", () => {
  it("respects NO_COLOR even on a TTY", async () => {
    const original = Object.getOwnPropertyDescriptor(process.stdout, "isTTY");
    Object.defineProperty(process.stdout, "isTTY", { value: true, configurable: true });
    process.env.NO_COLOR = "1";
    try {
      const c = capture();
      await runCli(
        ["verify", ...FIXTURE_ARGS, "--runs", "1", "--output", `${TMP}/no-color`],
        c.io,
      );
      expect(c.all()).not.toMatch(ANSI_PATTERN);
    } finally {
      delete process.env.NO_COLOR;
      if (original) Object.defineProperty(process.stdout, "isTTY", original);
    }
  });
});
