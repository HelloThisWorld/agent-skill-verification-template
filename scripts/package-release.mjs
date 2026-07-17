import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { buildCliBundle, CLI_BUNDLE_PATH } from "./build-cli.mjs";
import { buildStandalone, standaloneBinaryName } from "./build-standalone.mjs";

/**
 * Assemble release archives for the CURRENT platform:
 *
 *   agent-skill-verifier-v<version>-<platform>-<arch>.(zip|tar.gz)  (standalone SEA binary)
 *   agent-skill-verifier-v<version>-node.zip                        (portable Node bundle)
 *
 * Each archive contains LICENSE, QUICKSTART.md, and a release-manifest.json
 * whose file hashes are computed from the exact packaged bytes. Archives land
 * in dist/release/.
 *
 * Flags: --portable-only | --standalone-only
 */

const root = process.cwd();
const pkg = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));

const PLATFORM_NAMES = { win32: "windows", linux: "linux", darwin: "macos" };

function sha256(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function gitCommit() {
  if (process.env.GITHUB_SHA) return process.env.GITHUB_SHA;
  const result = spawnSync("git", ["rev-parse", "HEAD"], { encoding: "utf8", cwd: root });
  return result.status === 0 ? result.stdout.trim() : "unknown";
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { stdio: "inherit", ...options });
  if (result.status !== 0) {
    throw new Error(`Command failed (${result.status}): ${command} ${args.join(" ")}`);
  }
}

function quickstart(version, runLine) {
  return `# Agent Skill Verifier ${version} — Quickstart

A model-independent quality gate for AI agent skills.

## Run it

\`\`\`
${runLine} --help
${runLine} --version
\`\`\`

## Verify a skill

\`\`\`
${runLine} verify --skill ./skills/my-skill --cases ./evals/my-skill.yaml --runs 10 --threshold 0.90
\`\`\`

Reports (summary.json, junit.xml, report.html, events.jsonl, replays/) are
written to .agent-skill-verification/ by default. Paths are resolved relative
to the current working directory.

## Exit codes

0 passed | 1 quality gate failed | 2 invalid input | 3 adapter unavailable
4 runtime failure | 5 timeout/cancelled | 6 report/artifact failure

## Verify this download

Compare the SHA-256 of the archive with SHA256SUMS.txt on the GitHub Release
page. Checksums detect corruption and tampering of the published assets; they
do not prove publisher identity. Binaries are not code-signed.

Documentation: https://github.com/HelloThisWorld/agent-skill-verification-template
`;
}

function writeManifest(stageDir, { platform, architecture, runtime, files }) {
  const manifest = {
    schemaVersion: "1.0.0",
    name: "agent-skill-verifier",
    version: pkg.version,
    platform,
    architecture,
    runtime,
    nodeVersion: process.version.replace(/^v/, ""),
    commit: gitCommit(),
    builtAt: new Date().toISOString(),
    files: files
      .slice()
      .sort((a, b) => a.localeCompare(b))
      .map((name) => ({ path: name, sha256: sha256(join(stageDir, name)) })),
  };
  writeFileSync(
    join(stageDir, "release-manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf8",
  );
  return manifest;
}

function createZip(stageDir, outPath) {
  if (process.platform === "win32") {
    run("powershell.exe", [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      `Compress-Archive -Path "${stageDir}\\*" -DestinationPath "${outPath}" -Force`,
    ]);
  } else {
    run("zip", ["-r", "-X", "-q", outPath, "."], { cwd: stageDir });
  }
}

function createTarGz(stageDir, outPath) {
  run("tar", ["-czf", outPath, "-C", stageDir, "."]);
}

function stageCommonFiles(stageDir, runLine) {
  copyFileSync(resolve(root, "LICENSE"), join(stageDir, "LICENSE"));
  writeFileSync(join(stageDir, "QUICKSTART.md"), quickstart(pkg.version, runLine), "utf8");
  return ["LICENSE", "QUICKSTART.md"];
}

export async function packageStandalone() {
  const platform = PLATFORM_NAMES[process.platform];
  if (!platform) throw new Error(`Unsupported platform: ${process.platform}`);
  const architecture = process.arch;

  const { binaryPath } = await buildStandalone();
  const binaryName = standaloneBinaryName();

  const archiveBase = `agent-skill-verifier-v${pkg.version}-${platform}-${architecture}`;
  const stageDir = resolve(root, "dist/release/stage", archiveBase);
  rmSync(stageDir, { recursive: true, force: true });
  mkdirSync(stageDir, { recursive: true });

  copyFileSync(binaryPath, join(stageDir, binaryName));
  const files = [binaryName, ...stageCommonFiles(stageDir, platform === "windows" ? `.\\${binaryName}` : `./${binaryName}`)];
  writeManifest(stageDir, { platform, architecture, runtime: "node-sea", files });

  const ext = platform === "windows" ? "zip" : "tar.gz";
  const outPath = resolve(root, "dist/release", `${archiveBase}.${ext}`);
  rmSync(outPath, { force: true });
  mkdirSync(resolve(root, "dist/release"), { recursive: true });
  if (ext === "zip") createZip(stageDir, outPath);
  else createTarGz(stageDir, outPath);
  console.log(`Packaged ${outPath}`);
  return outPath;
}

export async function packagePortable() {
  await buildCliBundle();

  const archiveBase = `agent-skill-verifier-v${pkg.version}-node`;
  const stageDir = resolve(root, "dist/release/stage", archiveBase);
  rmSync(stageDir, { recursive: true, force: true });
  mkdirSync(stageDir, { recursive: true });

  copyFileSync(resolve(root, CLI_BUNDLE_PATH), join(stageDir, "agent-skill-verifier.cjs"));

  // Minimal launchers so the portable bundle behaves like a binary.
  writeFileSync(
    join(stageDir, "agent-skill-verifier.cmd"),
    '@echo off\r\nnode "%~dp0agent-skill-verifier.cjs" %*\r\n',
    "utf8",
  );
  writeFileSync(
    join(stageDir, "agent-skill-verifier"),
    '#!/bin/sh\nexec node "$(dirname "$0")/agent-skill-verifier.cjs" "$@"\n',
    { encoding: "utf8", mode: 0o755 },
  );

  // Package metadata: lets `npm install -g .` register the bin if desired.
  writeFileSync(
    join(stageDir, "package.json"),
    `${JSON.stringify(
      {
        name: "agent-skill-verifier",
        version: pkg.version,
        description: "Portable Node distribution of Agent Skill Verifier (requires Node.js >= 18.18).",
        license: pkg.license,
        bin: { "agent-skill-verifier": "agent-skill-verifier.cjs" },
        engines: { node: ">=18.18" },
      },
      null,
      2,
    )}\n`,
    "utf8",
  );

  const files = [
    "agent-skill-verifier.cjs",
    "agent-skill-verifier.cmd",
    "agent-skill-verifier",
    "package.json",
    ...stageCommonFiles(stageDir, "node agent-skill-verifier.cjs"),
  ];
  writeManifest(stageDir, {
    platform: "any",
    architecture: "any",
    runtime: "node-portable",
    files,
  });

  const outPath = resolve(root, "dist/release", `${archiveBase}.zip`);
  rmSync(outPath, { force: true });
  mkdirSync(resolve(root, "dist/release"), { recursive: true });
  createZip(stageDir, outPath);
  console.log(`Packaged ${outPath}`);
  return outPath;
}

const invokedDirectly = process.argv[1] && process.argv[1].endsWith("package-release.mjs");
if (invokedDirectly) {
  if (!existsSync(resolve(root, "package.json"))) throw new Error("Run from the repository root.");
  const portableOnly = process.argv.includes("--portable-only");
  const standaloneOnly = process.argv.includes("--standalone-only");
  if (!portableOnly) await packageStandalone();
  if (!standaloneOnly) await packagePortable();
}
