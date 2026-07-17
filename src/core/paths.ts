import { existsSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";

/**
 * Path helpers so the harness resolves files relative to one workspace root
 * regardless of which module asks. Citations are stored as
 * workspace-root-relative POSIX paths (forward slashes) for portability.
 *
 * Resolution rules:
 *   - The CLI pins the root to the current working directory at startup
 *     (`setWorkspaceRoot(process.cwd())`), so every user-supplied path is
 *     resolved relative to where the command was invoked.
 *   - Library/dev usage (npm scripts, vitest) falls back to walking up from the
 *     current working directory until a package.json is found, which lands on
 *     the repository root for all in-repo invocations.
 *
 * This module intentionally avoids `import.meta` so it behaves identically in
 * ESM dev mode, the bundled CommonJS CLI, and the standalone executable.
 */

let cachedRoot: string | null = null;

/** Pin the workspace root explicitly (used by the CLI entry point). */
export function setWorkspaceRoot(dir: string): void {
  cachedRoot = resolve(dir);
}

/** Locate the workspace root: pinned root, else walk up from cwd to a package.json. */
export function repoRoot(): string {
  if (cachedRoot) return cachedRoot;
  let dir = process.cwd();
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

/** Resolve a workspace-relative path to an absolute filesystem path. */
export function resolveFromRoot(relPath: string): string {
  return resolve(repoRoot(), relPath);
}

/** Normalize an absolute path to a workspace-relative POSIX path. */
export function toRepoRelativePosix(absPath: string): string {
  const rel = absPath.startsWith(repoRoot()) ? absPath.slice(repoRoot().length + 1) : absPath;
  return rel.split(sep).join("/");
}

/** True when `candidate` resolves to a location inside (or equal to) `base`. */
export function isInside(base: string, candidate: string): boolean {
  const absBase = resolve(base);
  const absCandidate = resolve(candidate);
  return absCandidate === absBase || absCandidate.startsWith(absBase + sep);
}

/** Location of the sample fixture repo the skill answers questions about. */
export const FIXTURE_ROOT = "fixtures/sample-repo";
