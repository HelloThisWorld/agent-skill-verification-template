import { readFileSync } from "node:fs";
import { resolveFromRoot } from "../core/paths.js";
import type { Tool, ToolContext, ToolResult } from "./tool-registry.js";

export interface ReadFileResult extends ToolResult {
  path: string;
  content: string;
  lineCount: number;
}

/**
 * `read_file` — read a file from the fixture repo by its repo-relative path.
 * Throws if the path does not exist (recorded as a failed tool call by the
 * registry), which is exactly how a real file tool should behave.
 */
export const readFileTool: Tool<{ path: string }, ReadFileResult> = {
  name: "read_file",
  description: "Read a file from the fixture repo by repo-relative path.",
  execute(args: { path: string }, _ctx: ToolContext): ReadFileResult {
    const rel = String(args.path ?? "");
    const abs = resolveFromRoot(rel);
    const content = readFileSync(abs, "utf8");
    const lineCount = content.split(/\r?\n/).length;
    return {
      summary: `read ${rel} (${lineCount} lines)`,
      path: rel,
      content,
      lineCount,
    };
  },
};
