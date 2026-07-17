import { readFileSync } from "node:fs";
import { join } from "node:path";
import { repoRoot } from "./paths.js";

/**
 * Single source of the tool identity. The release bundle injects the version at
 * build time (esbuild `--define:__ASV_VERSION__`), so the standalone executable
 * never needs package.json at runtime. Dev mode falls back to reading the
 * repository package.json.
 */

declare const __ASV_VERSION__: string | undefined;

export const TOOL_NAME = "agent-skill-verifier";

function packageJsonVersion(): string | null {
  try {
    const raw = readFileSync(join(repoRoot(), "package.json"), "utf8");
    const parsed = JSON.parse(raw) as { version?: unknown };
    return typeof parsed.version === "string" ? parsed.version : null;
  } catch {
    return null;
  }
}

export function toolVersion(): string {
  if (typeof __ASV_VERSION__ === "string" && __ASV_VERSION__.length > 0) {
    return __ASV_VERSION__;
  }
  return packageJsonVersion() ?? "0.0.0-dev";
}
