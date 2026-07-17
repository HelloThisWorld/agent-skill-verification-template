import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

/**
 * Generate SHA256SUMS.txt (sha256sum-compatible: `<hash>  <name>`) and
 * SHA256SUMS.json over every release archive in the target directory.
 *
 * Deterministic: assets are ordered by name, hashes are lowercase hex, and no
 * timestamps are embedded — identical inputs produce identical output.
 *
 * Usage: node scripts/generate-checksums.mjs [dir=dist/release] [--verify]
 */

const args = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const verifyMode = process.argv.includes("--verify");
const dir = resolve(process.cwd(), args[0] ?? "dist/release");

const ASSET_PATTERN = /\.(zip|tar\.gz)$/;

function collectAssets() {
  if (!existsSync(dir)) {
    console.error(`No such directory: ${dir}`);
    process.exit(1);
  }
  return readdirSync(dir)
    .filter((name) => ASSET_PATTERN.test(name) && statSync(join(dir, name)).isFile())
    .sort((a, b) => a.localeCompare(b));
}

function hashFile(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

const assets = collectAssets();
if (assets.length === 0) {
  console.error(`No release archives (*.zip, *.tar.gz) found in ${dir}`);
  process.exit(1);
}

const entries = assets.map((name) => ({
  name,
  sha256: hashFile(join(dir, name)),
  bytes: statSync(join(dir, name)).size,
}));

const txt = `${entries.map((e) => `${e.sha256}  ${e.name}`).join("\n")}\n`;
const json = `${JSON.stringify(
  {
    schemaVersion: "1.0.0",
    algorithm: "sha256",
    assets: entries,
  },
  null,
  2,
)}\n`;

if (verifyMode) {
  const existing = readFileSync(join(dir, "SHA256SUMS.txt"), "utf8");
  if (existing !== txt) {
    console.error("SHA256SUMS.txt does NOT match the current archives.");
    process.exit(1);
  }
  console.log(`SHA256SUMS.txt verified for ${entries.length} asset(s).`);
} else {
  writeFileSync(join(dir, "SHA256SUMS.txt"), txt, "utf8");
  writeFileSync(join(dir, "SHA256SUMS.json"), json, "utf8");
  console.log(`Wrote SHA256SUMS.txt and SHA256SUMS.json for ${entries.length} asset(s) in ${dir}`);
  for (const e of entries) console.log(`  ${e.sha256}  ${e.name}`);
}
