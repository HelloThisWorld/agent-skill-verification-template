import { existsSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Path helpers so the harness resolves files relative to the repository root
 * regardless of the current working directory. Citations are stored as
 * repo-root-relative POSIX paths (forward slashes) for portability.
 */

let cachedRoot: string | null = null;

/** Locate the repository root by walking up until a package.json is found. */
export function repoRoot(): string {
  if (cachedRoot) return cachedRoot;
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 10; i++) {
    if (existsSync(join(dir, "package.json"))) {
      cachedRoot = dir;
      return dir;
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  cachedRoot = process.cwd();
  return cachedRoot;
}

/** Resolve a repo-relative path to an absolute filesystem path. */
export function resolveFromRoot(relPath: string): string {
  return resolve(repoRoot(), relPath);
}

/** Normalize an absolute path to a repo-relative POSIX path. */
export function toRepoRelativePosix(absPath: string): string {
  const rel = absPath.startsWith(repoRoot()) ? absPath.slice(repoRoot().length + 1) : absPath;
  return rel.split(sep).join("/");
}

/** Location of the sample fixture repo the skill answers questions about. */
export const FIXTURE_ROOT = "fixtures/sample-repo";
