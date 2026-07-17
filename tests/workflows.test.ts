import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import { describe, expect, it } from "vitest";
import { resolveFromRoot } from "../src/core/paths.js";

/**
 * Workflow contract tests: the CI and Release workflows are parsed and their
 * security-relevant structure (triggers, permissions, publication guards) is
 * asserted so a regression cannot slip in unnoticed. Tag/version consistency
 * and missing-asset detection are exercised against the real scripts.
 */

function loadWorkflow(name: string): Record<string, any> {
  const text = readFileSync(resolveFromRoot(`.github/workflows/${name}`), "utf8");
  return parseYaml(text) as Record<string, any>;
}

// YAML 1.1 parses the bare key `on` as boolean true; support both spellings.
function triggersOf(workflow: Record<string, any>): Record<string, any> {
  return (workflow.on ?? workflow[true as unknown as string]) as Record<string, any>;
}

function runNode(args: string[]): { status: number | null; stdout: string; stderr: string } {
  return spawnSync(process.execPath, args, {
    cwd: resolveFromRoot("."),
    encoding: "utf8",
  });
}

describe("ci workflow", () => {
  const wf = loadWorkflow("ci.yml");

  it("parses and triggers on pull_request and pushes to main", () => {
    const on = triggersOf(wf);
    expect(on).toHaveProperty("pull_request");
    expect(on.push.branches).toEqual(["main"]);
  });

  it("has read-only contents permission and no write grants", () => {
    expect(wf.permissions).toEqual({ contents: "read" });
    for (const job of Object.values<any>(wf.jobs)) {
      expect(job.permissions?.contents).not.toBe("write");
    }
  });

  it("runs lint, typecheck, tests, build, and the packaged smoke test", () => {
    const steps = wf.jobs.quality.steps.map((s: any) => s.run ?? "").join("\n");
    for (const cmd of ["npm run lint", "npm run typecheck", "npm test", "npm run build", "smoke-test.mjs"]) {
      expect(steps).toContain(cmd);
    }
  });

  it("pins an exact Node version", () => {
    expect(wf.env.NODE_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });
});

describe("release workflow", () => {
  const wf = loadWorkflow("release.yml");

  it("parses and triggers on v*.*.* tags plus manual dry runs", () => {
    const on = triggersOf(wf);
    expect(on.push.tags).toEqual(["v*.*.*"]);
    expect(on).toHaveProperty("workflow_dispatch");
    expect(on).not.toHaveProperty("pull_request");
  });

  it("grants contents:write to the release job only", () => {
    expect(wf.permissions).toEqual({ contents: "read" });
    for (const [name, job] of Object.entries<any>(wf.jobs)) {
      if (name === "release") {
        expect(job.permissions).toEqual({ contents: "write" });
      } else {
        expect(job.permissions?.contents ?? "read").not.toBe("write");
      }
    }
  });

  it("publishes only for pushed tags (dry runs and PRs can never release)", () => {
    const releaseIf = String(wf.jobs.release.if);
    expect(releaseIf).toContain("github.event_name == 'push'");
    expect(releaseIf).toContain("refs/tags/v");
  });

  it("builds all four platform targets plus the portable bundle", () => {
    const targets = wf.jobs["build-platform"].strategy.matrix.include.map((m: any) => m.target);
    expect(targets).toEqual(["windows-x64", "linux-x64", "macos-x64", "macos-arm64"]);
    expect(wf.jobs["build-portable"]).toBeDefined();
  });

  it("follows the draft-first publication sequence with asset verification", () => {
    const runs = wf.jobs.release.steps.map((s: any) => s.run ?? "").join("\n");
    expect(runs).toContain("--require-assets windows-x64,linux-x64,macos-x64,macos-arm64,node");
    expect(runs).toContain("generate-checksums.mjs dist/release --verify");
    expect(runs).toContain("--draft");
    expect(runs).toContain("already exists — refusing to overwrite");
    expect(runs).toContain("gh release upload");
    expect(runs).not.toContain("--clobber");
    expect(runs).toContain("--draft=false");
    // Upload and verification must happen before publication.
    expect(runs.indexOf("gh release upload")).toBeLessThan(runs.indexOf("--draft=false"));
    expect(runs.indexOf("diff expected.txt uploaded.txt")).toBeLessThan(runs.indexOf("--draft=false"));
  });

  it("uses the ephemeral github.token, not a PAT", () => {
    const text = readFileSync(resolveFromRoot(".github/workflows/release.yml"), "utf8");
    expect(text).toContain("GH_TOKEN: ${{ github.token }}");
    expect(text).not.toMatch(/secrets\.[A-Z_]*PAT/);
    expect(text).not.toMatch(/secrets\.GH_PAT/);
  });

  it("has release concurrency keyed on the ref and no cancellation", () => {
    expect(wf.concurrency.group).toContain("release-");
    expect(wf.concurrency["cancel-in-progress"]).toBe(false);
  });
});

describe("skill-eval workflow (regression)", () => {
  it("still exists with read-only permissions", () => {
    const wf = loadWorkflow("skill-eval.yml");
    expect(wf.permissions).toEqual({ contents: "read" });
  });
});

describe("release-check tag validation", () => {
  const pkg = JSON.parse(readFileSync(resolveFromRoot("package.json"), "utf8"));

  it("accepts the tag that matches the package version", () => {
    const r = runNode(["scripts/release-check.mjs", "--tag-only", "--tag", `v${pkg.version}`]);
    expect(r.status).toBe(0);
  });

  it("rejects malformed tags", () => {
    const r = runNode(["scripts/release-check.mjs", "--tag-only", "--tag", "not-a-tag"]);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("does not match the required");
  });

  it("rejects a tag/version mismatch", () => {
    const r = runNode(["scripts/release-check.mjs", "--tag-only", "--tag", "v99.99.99"]);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("does not match package version");
  });

  it("fails when expected release assets are missing", () => {
    const empty = mkdtempSync(join(tmpdir(), "asv-empty-release-"));
    try {
      const r = runNode([
        "scripts/release-check.mjs",
        "--dir",
        empty,
        "--require-assets",
        "windows-x64,linux-x64,macos-x64,macos-arm64,node",
      ]);
      expect(r.status).toBe(1);
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
  });
});

describe("release notes", () => {
  it("contain installation and checksum guidance for the current version", () => {
    const pkg = JSON.parse(readFileSync(resolveFromRoot("package.json"), "utf8"));
    const r = runNode(["scripts/release-notes.mjs"]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("## Installation");
    expect(r.stdout).toContain(`agent-skill-verifier-v${pkg.version}-windows-x64.zip`);
    expect(r.stdout).toContain("SHA256SUMS.txt");
    expect(r.stdout).toContain("not code-signed");
  });
});
