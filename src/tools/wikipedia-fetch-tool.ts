import { readFileSync } from "node:fs";
import { resolveFromRoot, toRepoRelativePosix } from "../core/paths.js";
import { parseSnapshot, type GlossarySnapshotData } from "../skills/glossary/snapshot.js";
import type { Tool, ToolContext, ToolResult } from "./tool-registry.js";

/**
 * `wikipedia_fetch` — the glossary skill's confirmation/read tool.
 *
 * Given a snapshot path (from `wikipedia_search`) or a raw query term, it reads
 * the offline Wikipedia snapshot, recovers the structured article data, and
 * reports the citable "lede" line number. This is the analogue of `read_file`
 * for the codebase skill: the model reads its evidence before answering.
 */

export interface WikipediaFetchResult extends ToolResult {
  /** Repo-relative POSIX path to the snapshot that was read. */
  path: string;
  title: string;
  url: string;
  description: string;
  extract: string;
  thumbnail: string;
  lang: string;
  /** 1-indexed citable line (contains the exact query term). */
  ledeLine: number;
  lineCount: number;
  data: GlossarySnapshotData;
}

/** Resolve the caller's argument to a repo-relative snapshot path. */
function resolvePath(args: { path?: string; query?: string; title?: string }, ctx: ToolContext): string {
  if (args.path) return String(args.path);
  const term = String(args.query ?? args.title ?? "").trim();
  if (!term) throw new Error("wikipedia_fetch requires a 'path' or 'query' argument");
  return `${ctx.fixtureRoot.replace(/\/$/, "")}/${term}.html`;
}

export const wikipediaFetchTool: Tool<
  { path?: string; query?: string; title?: string },
  WikipediaFetchResult
> = {
  name: "wikipedia_fetch",
  description:
    "Read an offline Wikipedia snapshot by path (or query term) and return its structured article data and citable line.",
  execute(args, _ctx): WikipediaFetchResult {
    const rel = toRepoRelativePosix(resolveFromRoot(resolvePath(args, _ctx)));
    const html = readFileSync(resolveFromRoot(rel), "utf8");
    const parsed = parseSnapshot(html);
    if (!parsed) {
      throw new Error(`snapshot missing embedded glossary-data: ${rel}`);
    }
    const { data, ledeLine, lineCount } = parsed;
    return {
      summary: `read ${rel} (${lineCount} lines, lede@${ledeLine}) — ${data.title}`,
      path: rel,
      title: data.title,
      url: data.url,
      description: data.description,
      extract: data.extract,
      thumbnail: data.thumbnail,
      lang: data.lang,
      ledeLine,
      lineCount,
      data,
    };
  },
};
