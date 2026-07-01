import { readdirSync, readFileSync } from "node:fs";
import { extname, join } from "node:path";
import { resolveFromRoot, toRepoRelativePosix } from "../core/paths.js";
import type { Tool, ToolContext, ToolResult } from "./tool-registry.js";

/** A single search hit inside the fixture repo. */
export interface SearchMatch {
  file: string;
  line: number;
  text: string;
}

export interface RepoSearchResult extends ToolResult {
  matches: SearchMatch[];
}

const SEARCHABLE_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".md", ".json"]);

/** Recursively list searchable files under a directory, sorted for determinism. */
function listFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const abs = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...listFiles(abs));
    } else if (SEARCHABLE_EXTENSIONS.has(extname(entry.name))) {
      out.push(abs);
    }
  }
  return out.sort();
}

/**
 * `repo_search` — case-insensitive substring search across the fixture repo.
 * Returns matches as `{ file, line, text }`, where `file` is a repo-relative
 * POSIX path and `line` is 1-indexed, ready to be used directly as a citation.
 */
export const repoSearchTool: Tool<{ query: string }, RepoSearchResult> = {
  name: "repo_search",
  description:
    "Case-insensitive substring search across the fixture repo. Returns {file, line, text} matches.",
  execute(args: { query: string }, ctx: ToolContext): RepoSearchResult {
    const query = String(args.query ?? "").toLowerCase();
    const matches: SearchMatch[] = [];

    if (query.length > 0) {
      const root = resolveFromRoot(ctx.fixtureRoot);
      for (const abs of listFiles(root)) {
        const rel = toRepoRelativePosix(abs);
        const lines = readFileSync(abs, "utf8").split(/\r?\n/);
        lines.forEach((line, index) => {
          if (line.toLowerCase().includes(query)) {
            matches.push({ file: rel, line: index + 1, text: line.trim() });
          }
        });
      }
    }

    return {
      summary: `${matches.length} match(es) for "${args.query ?? ""}"`,
      matches,
    };
  },
};
