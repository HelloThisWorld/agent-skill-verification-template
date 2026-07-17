import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

/**
 * Release gatekeeper: validates every archive in dist/release before anything
 * is tagged or uploaded.
 *
 * Checks per archive:
 *   - expected members are present (binary or portable bundle, LICENSE,
 *     QUICKSTART.md, release-manifest.json)
 *   - release-manifest.json is schema-valid, version-consistent, and its
 *     SHA-256 entries match the packaged bytes
 *   - no forbidden files (.env*, keys, .git, source maps, node_modules)
 *   - archive filename embeds the package version
 *
 * Global checks:
 *   - the portable bundle reports the package version via --version
 *   - optional --tag v<x.y.z> must equal `v` + package.json version
 *   - --require-commit-match makes a manifest/HEAD mismatch fatal (used in CI)
 *   - SHA256SUMS.txt, when present, matches the archives
 *
 * Usage:
 *   node scripts/release-check.mjs [--dir dist/release] [--tag vX.Y.Z]
 *        [--require-commit-match] [--require-assets <list>] [--tag-only]
 *
 * --tag-only        validate only the tag/version rules (no archives needed)
 * --require-assets  comma list of expected asset suffixes, e.g.
 *                   windows-x64,linux-x64,macos-x64,macos-arm64,node
 */

const root = process.cwd();
const pkg = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));

const argv = process.argv.slice(2);
function argValue(flag) {
  const i = argv.indexOf(flag);
  return i !== -1 ? argv[i + 1] : undefined;
}
const dir = resolve(root, argValue("--dir") ?? "dist/release");
const tag = argValue("--tag");
const requireCommitMatch = argv.includes("--require-commit-match");
const tagOnly = argv.includes("--tag-only");
const requireAssets = argValue("--require-assets");

/** Expected archive filename for an asset suffix like "windows-x64" or "node". */
function expectedAssetName(suffix) {
  const ext = suffix === "node" || suffix.startsWith("windows") ? "zip" : "tar.gz";
  return `agent-skill-verifier-v${pkg.version}-${suffix}.${ext}`;
}

const errors = [];
const warnings = [];

const FORBIDDEN_PATTERNS = [
  /(^|\/)\.env($|\.)/i,
  /\.pem$/i,
  /\.key$/i,
  /(^|\/)id_rsa/i,
  /(^|\/)\.git(\/|$|ignore$|config$)/i,
  /\.map$/i,
  /(^|\/)node_modules(\/|$)/i,
  /\.npmrc$/i,
];

function sha256(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function listFilesRecursive(base, prefix = "") {
  const out = [];
  for (const entry of readdirSync(join(base, prefix), { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) out.push(...listFilesRecursive(base, rel));
    else out.push(rel);
  }
  return out.sort();
}

function extract(archivePath, destDir) {
  if (archivePath.endsWith(".zip")) {
    if (process.platform === "win32") {
      const r = spawnSync(
        "powershell.exe",
        [
          "-NoProfile",
          "-NonInteractive",
          "-Command",
          `Expand-Archive -Path "${archivePath}" -DestinationPath "${destDir}" -Force`,
        ],
        { stdio: "pipe", encoding: "utf8" },
      );
      if (r.status !== 0) throw new Error(`Expand-Archive failed: ${r.stderr}`);
    } else {
      const r = spawnSync("unzip", ["-q", "-o", archivePath, "-d", destDir], { stdio: "pipe" });
      if (r.status !== 0) throw new Error(`unzip failed for ${archivePath}`);
    }
  } else {
    // On Windows, prefer the system bsdtar: a GNU tar found on PATH (e.g. from
    // Git Bash) misreads drive-letter paths like D:\ as remote-host specs.
    const systemTar = "C:\\Windows\\System32\\tar.exe";
    const tarCmd = process.platform === "win32" && existsSync(systemTar) ? systemTar : "tar";
    const r = spawnSync(tarCmd, ["-xzf", archivePath, "-C", destDir], {
      stdio: "pipe",
      encoding: "utf8",
    });
    if (r.status !== 0) {
      throw new Error(`tar -xzf failed for ${archivePath}: ${(r.stderr ?? "").trim()}`);
    }
  }
}

function gitHead() {
  if (process.env.GITHUB_SHA) return process.env.GITHUB_SHA;
  const r = spawnSync("git", ["rev-parse", "HEAD"], { encoding: "utf8", cwd: root });
  return r.status === 0 ? r.stdout.trim() : null;
}

function validateManifest(archiveName, extractedDir, files) {
  const manifestPath = join(extractedDir, "release-manifest.json");
  if (!existsSync(manifestPath)) {
    errors.push(`${archiveName}: release-manifest.json is missing`);
    return;
  }
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  } catch (e) {
    errors.push(`${archiveName}: release-manifest.json is not valid JSON (${e.message})`);
    return;
  }

  const requiredStrings = [
    "schemaVersion",
    "name",
    "version",
    "platform",
    "architecture",
    "runtime",
    "nodeVersion",
    "commit",
    "builtAt",
  ];
  for (const field of requiredStrings) {
    if (typeof manifest[field] !== "string" || manifest[field].length === 0) {
      errors.push(`${archiveName}: manifest field "${field}" is missing or empty`);
    }
  }
  if (manifest.name !== "agent-skill-verifier") {
    errors.push(`${archiveName}: manifest name "${manifest.name}" != agent-skill-verifier`);
  }
  if (manifest.version !== pkg.version) {
    errors.push(`${archiveName}: manifest version "${manifest.version}" != package version "${pkg.version}"`);
  }
  if (!Array.isArray(manifest.files) || manifest.files.length === 0) {
    errors.push(`${archiveName}: manifest.files is missing or empty`);
    return;
  }
  for (const entry of manifest.files) {
    if (/[\\/]/.test(entry.path) || entry.path.includes("..")) {
      errors.push(`${archiveName}: manifest path "${entry.path}" must be a plain file name`);
      continue;
    }
    const filePath = join(extractedDir, entry.path);
    if (!existsSync(filePath)) {
      errors.push(`${archiveName}: manifest lists "${entry.path}" but it is not in the archive`);
      continue;
    }
    const actual = sha256(filePath);
    if (actual !== entry.sha256) {
      errors.push(`${archiveName}: sha256 mismatch for "${entry.path}"`);
    }
    if (entry.sha256 !== entry.sha256.toLowerCase()) {
      errors.push(`${archiveName}: manifest sha256 for "${entry.path}" must be lowercase`);
    }
  }
  const manifestListed = new Set(manifest.files.map((f) => f.path));
  for (const file of files) {
    if (file !== "release-manifest.json" && !manifestListed.has(file)) {
      errors.push(`${archiveName}: file "${file}" is not listed in the manifest`);
    }
  }
  const head = gitHead();
  if (head && manifest.commit !== head && manifest.commit !== "unknown") {
    const msg = `${archiveName}: manifest commit ${manifest.commit.slice(0, 12)} != HEAD ${head.slice(0, 12)}`;
    if (requireCommitMatch) errors.push(msg);
    else warnings.push(`${msg} (informational for local builds)`);
  } else if (requireCommitMatch && (!head || manifest.commit === "unknown")) {
    errors.push(`${archiveName}: commit could not be verified (manifest=${manifest.commit})`);
  }
}

function checkArchive(archiveName) {
  const archivePath = join(dir, archiveName);
  if (!archiveName.includes(`v${pkg.version}`)) {
    errors.push(`${archiveName}: filename does not embed version v${pkg.version}`);
  }

  const workDir = mkdtempSync(join(tmpdir(), "asv-release-check-"));
  try {
    extract(archivePath, workDir);
    const files = listFilesRecursive(workDir);

    for (const file of files) {
      for (const pattern of FORBIDDEN_PATTERNS) {
        if (pattern.test(file)) {
          errors.push(`${archiveName}: forbidden file in archive: ${file}`);
        }
      }
    }

    const isPortable = archiveName.endsWith("-node.zip");
    const required = isPortable
      ? ["agent-skill-verifier.cjs", "package.json", "LICENSE", "QUICKSTART.md", "release-manifest.json"]
      : ["LICENSE", "QUICKSTART.md", "release-manifest.json"];
    for (const file of required) {
      if (!files.includes(file)) errors.push(`${archiveName}: missing required file ${file}`);
    }
    if (!isPortable) {
      const hasBinary =
        files.includes("agent-skill-verifier") || files.includes("agent-skill-verifier.exe");
      if (!hasBinary) errors.push(`${archiveName}: missing agent-skill-verifier binary`);
    }

    validateManifest(archiveName, workDir, files);

    // The portable bundle must actually run and report the right version.
    if (isPortable) {
      const r = spawnSync(process.execPath, [join(workDir, "agent-skill-verifier.cjs"), "--version"], {
        encoding: "utf8",
      });
      if (r.status !== 0 || r.stdout.trim() !== pkg.version) {
        errors.push(
          `${archiveName}: bundle --version reported "${(r.stdout ?? "").trim()}" (exit ${r.status}), expected "${pkg.version}"`,
        );
      }
    }
  } catch (e) {
    errors.push(`${archiveName}: ${e.message}`);
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
}

// --- run ---

if (tag !== undefined) {
  if (!/^v\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(tag)) {
    errors.push(`Tag "${tag}" does not match the required v<major>.<minor>.<patch> format.`);
  } else if (tag !== `v${pkg.version}`) {
    errors.push(`Tag "${tag}" does not match package version "v${pkg.version}".`);
  }
}

if (tagOnly) {
  if (tag === undefined) {
    console.error("--tag-only requires --tag <vX.Y.Z>.");
    process.exit(1);
  }
  if (errors.length > 0) {
    for (const e of errors) console.error(`ERROR ${e}`);
    process.exit(1);
  }
  console.log(`release-check: tag "${tag}" is valid and matches package version ${pkg.version}.`);
  process.exit(0);
}

if (!existsSync(dir)) {
  console.error(`Release directory not found: ${dir}`);
  process.exit(1);
}

const archives = readdirSync(dir)
  .filter((n) => /\.(zip|tar\.gz)$/.test(n) && statSync(join(dir, n)).isFile())
  .sort();

if (archives.length === 0) {
  console.error(`No archives found in ${dir}`);
  process.exit(1);
}

const names = new Set();
for (const archive of archives) {
  if (names.has(archive)) errors.push(`Duplicate asset name: ${archive}`);
  names.add(archive);
  checkArchive(archive);
}

// Every expected asset must be present, exactly once, before publication.
if (requireAssets) {
  for (const suffix of requireAssets.split(",").map((s) => s.trim()).filter(Boolean)) {
    const expected = expectedAssetName(suffix);
    if (!names.has(expected)) {
      errors.push(`Expected release asset is missing: ${expected}`);
    }
  }
}

// SHA256SUMS.txt consistency (when generated).
const sumsPath = join(dir, "SHA256SUMS.txt");
if (existsSync(sumsPath)) {
  const expected = archives.map((n) => `${sha256(join(dir, n))}  ${n}`).join("\n") + "\n";
  const actual = readFileSync(sumsPath, "utf8");
  if (actual !== expected) errors.push("SHA256SUMS.txt does not match the archives in the directory.");
}

for (const w of warnings) console.warn(`WARN  ${w}`);
if (errors.length > 0) {
  for (const e of errors) console.error(`ERROR ${e}`);
  console.error(`release-check: FAILED with ${errors.length} error(s) across ${archives.length} archive(s).`);
  process.exit(1);
}
console.log(`release-check: OK — ${archives.length} archive(s) validated for version ${pkg.version}.`);
