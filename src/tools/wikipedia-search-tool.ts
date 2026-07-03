import { existsSync, readdirSync, readFileSync } from "node:fs";
import { extname, join } from "node:path";
import { resolveFromRoot, toRepoRelativePosix } from "../core/paths.js";
import type { Tool, ToolContext, ToolResult } from "./tool-registry.js";

/**
 * `wikipedia_search` — the glossary skill's discovery tool.
 *
 * It searches the OFFLINE Wikipedia snapshot cache under the fixture root
 * (`fixtures/wikipedia/`, populated by `npm run glossary:build-cache`). This
 * mirrors how `repo_search` works for the codebase skill: deterministic,
 * offline, and returning `{file, line, text}` matches that are ready to be used
 * directly as citations.
 *
 * Ranking models "the best-matching article first": the snapshot whose filename
 * equals the query (the article for that term) is returned ahead of pages that
 * merely mention the term in passing.
 */

export interface WikiSearchMatch {
  /** The snapshot's term (its filename without extension). */
  title: string;
  /** Repo-relative POSIX path to the snapshot, usable as a citation `file`. */
  file: string;
  /** 1-indexed line number of the match. */
  line: number;
  /** Trimmed text of the matching line. */
  text: string;
}

export interface WikipediaSearchResult extends ToolResult {
  matches: WikiSearchMatch[];
  /** Distinct snapshot files that matched, best-ranked first. */
  files: string[];
}

function listSnapshots(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isFile() && extname(e.name) === ".html")
    .map((e) => join(dir, e.name))
    .sort();
}

function termOf(fileName: string): string {
  return fileName.replace(/\.html$/i, "");
}

export const wikipediaSearchTool: Tool<{ query: string }, WikipediaSearchResult> = {
  name: "wikipedia_search",
  description:
    "Search the offline Wikipedia snapshot cache for a term. Returns {title, file, line, text} matches, best-matching article first.",
  parameters: { query: "the term to search for (string)" },
  execute(args: { query: string }, ctx: ToolContext): WikipediaSearchResult {
    const query = String(args.query ?? "").trim();
    const queryLow = query.toLowerCase();
    const root = resolveFromRoot(ctx.fixtureRoot);
    const matches: WikiSearchMatch[] = [];

    if (queryLow.length > 0) {
      for (const abs of listSnapshots(root)) {
        const rel = toRepoRelativePosix(abs);
        const term = termOf(abs.split(/[\\/]/).pop() ?? "");
        const lines = readFileSync(abs, "utf8").split(/\r?\n/);
        lines.forEach((line, index) => {
          if (line.toLowerCase().includes(queryLow)) {
            matches.push({ title: term, file: rel, line: index + 1, text: line.trim() });
          }
        });
      }
    }

    // Rank: the article whose term IS the query first, then by match density.
    const perFile = new Map<string, number>();
    for (const m of matches) perFile.set(m.file, (perFile.get(m.file) ?? 0) + 1);
    const isExact = (m: WikiSearchMatch): number => (m.title === query ? 0 : 1);
    matches.sort(
      (a, b) =>
        isExact(a) - isExact(b) ||
        (perFile.get(b.file) ?? 0) - (perFile.get(a.file) ?? 0) ||
        a.file.localeCompare(b.file) ||
        a.line - b.line,
    );

    const files: string[] = [];
    for (const m of matches) if (!files.includes(m.file)) files.push(m.file);

    return {
      summary: `${matches.length} match(es) across ${files.length} snapshot(s) for "${query}"`,
      matches,
      files,
    };
  },
};
