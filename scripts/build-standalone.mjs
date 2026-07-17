import { spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { buildCliBundle } from "./build-cli.mjs";

/**
 * Build a standalone executable for the CURRENT platform using the official
 * Node.js Single Executable Application (SEA) mechanism:
 *
 *   1. bundle the CLI to one CJS file (esbuild)
 *   2. node --experimental-sea-config  -> preparation blob
 *   3. copy the running node binary    -> dist/sea/agent-skill-verifier[.exe]
 *   4. postject the blob into the copy (NODE_SEA_BLOB + sentinel fuse)
 *   5. macOS only: remove/re-add the ad-hoc code signature
 *
 * The SEA procedure follows the documentation of the pinned Node version used
 * by the release workflow (see .github/workflows/release.yml). The resulting
 * binary is NOT code-signed (documented limitation).
 */

const root = process.cwd();
const require = createRequire(import.meta.url);

const SEA_SENTINEL = "NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2";

function run(command, args, options = {}) {
  const printable = [command, ...args].join(" ");
  const result = spawnSync(command, args, { stdio: "inherit", ...options });
  if (result.status !== 0) {
    throw new Error(`Command failed (${result.status}): ${printable}`);
  }
}

export function standaloneBinaryName() {
  return process.platform === "win32" ? "agent-skill-verifier.exe" : "agent-skill-verifier";
}

export async function buildStandalone() {
  const { version } = await buildCliBundle();

  const seaDir = resolve(root, "dist/sea");
  mkdirSync(seaDir, { recursive: true });

  const seaConfigPath = resolve(seaDir, "sea-config.json");
  const blobPath = resolve(seaDir, "sea-prep.blob");
  writeFileSync(
    seaConfigPath,
    `${JSON.stringify(
      {
        main: "dist/cli/agent-skill-verifier.cjs",
        output: "dist/sea/sea-prep.blob",
        disableExperimentalSEAWarning: true,
      },
      null,
      2,
    )}\n`,
    "utf8",
  );

  console.log(`SEA: generating preparation blob with node ${process.version}`);
  run(process.execPath, ["--experimental-sea-config", seaConfigPath], { cwd: root });

  const binaryPath = resolve(seaDir, standaloneBinaryName());
  copyFileSync(process.execPath, binaryPath);
  chmodSync(binaryPath, 0o755);

  if (process.platform === "darwin") {
    run("codesign", ["--remove-signature", binaryPath]);
  }

  const postjectCli = require.resolve("postject/dist/cli.js");
  const postjectArgs = [
    postjectCli,
    binaryPath,
    "NODE_SEA_BLOB",
    blobPath,
    "--sentinel-fuse",
    SEA_SENTINEL,
  ];
  if (process.platform === "darwin") {
    postjectArgs.push("--macho-segment-name", "NODE_SEA");
  }
  console.log("SEA: injecting blob with postject");
  run(process.execPath, postjectArgs, { cwd: root });

  if (process.platform === "darwin") {
    run("codesign", ["--sign", "-", binaryPath]);
  }

  // Smoke: the binary must report the package version without the repository.
  const check = spawnSync(binaryPath, ["--version"], { encoding: "utf8" });
  const reported = (check.stdout ?? "").trim();
  if (check.status !== 0 || reported !== version) {
    throw new Error(
      `Standalone binary self-check failed: exit=${check.status} version="${reported}" expected "${version}"\n${check.stderr ?? ""}`,
    );
  }
  console.log(`Built ${binaryPath} (version ${reported}, node ${process.version})`);
  return { binaryPath, version };
}

const invokedDirectly = process.argv[1] && process.argv[1].endsWith("build-standalone.mjs");
if (invokedDirectly) {
  if (!existsSync(resolve(root, "package.json"))) {
    throw new Error("Run from the repository root.");
  }
  await buildStandalone();
}
