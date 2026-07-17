import { rmSync } from "node:fs";
import { afterAll, describe, expect, it, vi } from "vitest";
import {
  AdapterUnavailableError,
  ArtifactError,
  InputError,
  VerificationRuntimeError,
  VerificationTimeoutError,
  exitCodeForError,
} from "../src/core/errors.js";
import { canonicalResultSchema } from "../src/core/canonical-result.js";
import { resolveFromRoot } from "../src/core/paths.js";
import { verifySkill } from "../src/core/verification-service.js";

/**
 * Verification-service tests: canonical result validity, seeded determinism,
 * honest metrics, and the exit-code mapping of the typed error hierarchy.
 */

const TMP = "tmp/service-tests";

afterAll(() => {
  rmSync(resolveFromRoot(TMP), { recursive: true, force: true });
});

const BASE = {
  skillPath: "fixtures/valid-skill",
  casesPath: "fixtures/evals.yaml",
  adapter: "mock",
  runsPerCase: 3,
  threshold: 0.9,
  formats: ["json", "junit", "html", "replay"] as const,
};

describe("verifySkill", () => {
  it("produces a schema-valid canonical result", async () => {
    const result = await verifySkill({
      ...BASE,
      formats: [...BASE.formats],
      outputDir: `${TMP}/canonical`,
    });
    const parsed = canonicalResultSchema.safeParse(result.outputs.canonical);
    expect(parsed.success).toBe(true);
    expect(result.gatePassed).toBe(true);
    expect(result.outputs.canonical.summary.totalRuns).toBe(9);
  });

  it("does not fabricate unsupported metrics", async () => {
    const result = await verifySkill({
      ...BASE,
      formats: [...BASE.formats],
      outputDir: `${TMP}/metrics`,
    });
    expect(result.outputs.canonical.metrics.toolSelectionAccuracy).toBeNull();
    expect(result.outputs.canonical.metrics.refusalAccuracy).toBeNull();
    expect(result.outputs.canonical.metrics.latencyMs.estimated).toBe(true);
    expect(result.outputs.canonical.metrics.tokenUsage.estimated).toBe(true);
  });

  it("is deterministic for a fixed seed (identical summaries and metrics)", async () => {
    const a = await verifySkill({
      ...BASE,
      formats: [...BASE.formats],
      seed: 12345,
      outputDir: `${TMP}/seed-a`,
    });
    const b = await verifySkill({
      ...BASE,
      formats: [...BASE.formats],
      seed: 12345,
      outputDir: `${TMP}/seed-b`,
    });
    expect(a.outputs.canonical.summary).toEqual(b.outputs.canonical.summary);
    expect(a.outputs.canonical.metrics).toEqual(b.outputs.canonical.metrics);
    expect(a.outputs.canonical.caseResults).toEqual(b.outputs.canonical.caseResults);
  });

  it("flags flaky cases and enforces maximumFlakyRate", async () => {
    const result = await verifySkill({
      ...BASE,
      formats: [...BASE.formats],
      adapter: "mock-flaky",
      runsPerCase: 8,
      threshold: 0,
      maximumFlakyRate: 0,
      outputDir: `${TMP}/flaky`,
    });
    expect(result.outputs.canonical.summary.flakyCases).toBeGreaterThan(0);
    expect(result.gatePassed).toBe(false);
    expect(
      result.outputs.canonical.gate.reasons.some((r) => r.includes("flaky-case rate")),
    ).toBe(true);
  });

  it("throws AdapterUnavailableError (exit 3) for unknown adapters", async () => {
    await expect(
      verifySkill({
        ...BASE,
        formats: [...BASE.formats],
        adapter: "missing-adapter",
        outputDir: `${TMP}/x`,
      }),
    ).rejects.toBeInstanceOf(AdapterUnavailableError);
  });

  it("throws VerificationTimeoutError (exit 5) when the deadline is exceeded", async () => {
    await expect(
      verifySkill({
        ...BASE,
        formats: [...BASE.formats],
        runsPerCase: 100,
        timeoutMs: 1,
        outputDir: `${TMP}/timeout`,
      }),
    ).rejects.toBeInstanceOf(VerificationTimeoutError);
  });

  it("wraps unexpected runtime failures as VerificationRuntimeError (exit 4)", async () => {
    vi.resetModules();
    vi.doMock("../src/core/eval-runner.js", async (importOriginal) => {
      const original = await importOriginal<typeof import("../src/core/eval-runner.js")>();
      return { ...original, runEvalCases: () => Promise.reject(new Error("simulated crash")) };
    });
    const { verifySkill: mockedVerify } = await import("../src/core/verification-service.js");
    // vi.resetModules re-instantiates the error classes, so assert on the
    // stable contract properties rather than instance identity.
    await expect(
      mockedVerify({ ...BASE, formats: [...BASE.formats], outputDir: `${TMP}/crash` }),
    ).rejects.toMatchObject({ kind: "runtime-failure", exitCode: 4 });
    vi.doUnmock("../src/core/eval-runner.js");
    vi.resetModules();
  });
});

describe("exit-code mapping", () => {
  it("maps every error class to its documented exit code", () => {
    expect(exitCodeForError(new InputError("x"))).toBe(2);
    expect(exitCodeForError(new AdapterUnavailableError("x"))).toBe(3);
    expect(exitCodeForError(new VerificationRuntimeError("x"))).toBe(4);
    expect(exitCodeForError(new VerificationTimeoutError("x"))).toBe(5);
    expect(exitCodeForError(new ArtifactError("x"))).toBe(6);
    expect(exitCodeForError(new Error("unexpected"))).toBe(4);
    expect(exitCodeForError("string throw")).toBe(4);
  });
});
