import type { RecordedToolCall } from "../core/types.js";
import { repoSearchTool } from "./repo-search-tool.js";
import { readFileTool } from "./read-file-tool.js";

/**
 * Tool contract and a recording registry.
 *
 * The registry is the boundary between a model adapter and the outside world.
 * Every invocation is recorded (order, timing, success, a short result summary)
 * so the tool-call validator and replay artifacts have a faithful trace of what
 * the skill actually did.
 */

export interface ToolContext {
  /** Repo-relative root the tools are allowed to read from. */
  fixtureRoot: string;
}

export interface ToolResult {
  /** Short human-readable summary recorded in the tool trace. */
  summary: string;
}

export interface Tool<
  A = Record<string, unknown>,
  R extends ToolResult = ToolResult,
> {
  name: string;
  description: string;
  // Declared as a method so parameter types are bivariant, letting concrete
  // tools (e.g. Tool<{ query: string }, ...>) register without casts.
  execute(args: A, ctx: ToolContext): R;
}

export class ToolRegistry {
  private readonly tools = new Map<string, Tool>();
  private readonly calls: RecordedToolCall[] = [];

  constructor(private readonly ctx: ToolContext) {}

  register(tool: Tool): this {
    this.tools.set(tool.name, tool);
    return this;
  }

  has(name: string): boolean {
    return this.tools.has(name);
  }

  list(): string[] {
    return [...this.tools.keys()];
  }

  /** Invoke a tool by name, recording the call. Throws if the tool throws. */
  invoke<R extends ToolResult>(name: string, args: Record<string, unknown>): R {
    const order = this.calls.length + 1;
    const startedAtMs = Date.now();
    const tool = this.tools.get(name);

    if (!tool) {
      const error = `unknown tool: ${name}`;
      this.calls.push({
        order,
        tool: name,
        arguments: args,
        ok: false,
        error,
        resultSummary: "",
        startedAtMs,
        durationMs: Date.now() - startedAtMs,
      });
      throw new Error(error);
    }

    try {
      const result = tool.execute(args, this.ctx) as R;
      this.calls.push({
        order,
        tool: name,
        arguments: args,
        ok: true,
        resultSummary: result.summary,
        startedAtMs,
        durationMs: Date.now() - startedAtMs,
      });
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.calls.push({
        order,
        tool: name,
        arguments: args,
        ok: false,
        error: message,
        resultSummary: "",
        startedAtMs,
        durationMs: Date.now() - startedAtMs,
      });
      throw error;
    }
  }

  /** All recorded calls, in invocation order. */
  recordedCalls(): RecordedToolCall[] {
    return this.calls;
  }
}

/** Registry pre-loaded with the tools available to the `codebase-understanding` skill. */
export function createDefaultToolRegistry(fixtureRoot: string): ToolRegistry {
  const registry = new ToolRegistry({ fixtureRoot });
  registry.register(repoSearchTool);
  registry.register(readFileTool);
  return registry;
}
