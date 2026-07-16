import type { RecordedToolCall } from "../core/types.js";
import { repoSearchTool } from "./repo-search-tool.js";
import { readFileTool } from "./read-file-tool.js";
import { wikipediaSearchTool } from "./wikipedia-search-tool.js";
import { wikipediaFetchTool } from "./wikipedia-fetch-tool.js";
import {
  openMindCapabilityRegistryTool,
  openMindGlossaryLookupTool,
  openMindRouteQueryTool,
  openMindSymbolDefinitionTool,
  openMindSymbolUsageTool,
  openMindTermUsageTool,
} from "./openmind-tools.js";
import { createSpecBridgeToolRegistry } from "./specbridge-tools.js";

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
  /** Argument documentation (name → description) surfaced to prompt-driven adapters. */
  parameters?: Record<string, string>;
  // Declared as a method so parameter types are bivariant, letting concrete
  // tools (e.g. Tool<{ query: string }, ...>) register without casts.
  // A tool may be async (return a Promise); async tools must be invoked via
  // `invokeAsync` so the recorded duration covers the real work.
  execute(args: A, ctx: ToolContext): R | Promise<R>;
}

/** Prompt-facing tool documentation (see ToolRegistry.describe). */
export interface ToolDescription {
  name: string;
  description: string;
  parameters: Record<string, string>;
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

  /** Documentation for every registered tool, for adapters that prompt a live model. */
  describe(): ToolDescription[] {
    return [...this.tools.values()].map((t) => ({
      name: t.name,
      description: t.description,
      parameters: t.parameters ?? {},
    }));
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
      if (result instanceof Promise) {
        throw new Error(`tool "${name}" is asynchronous; call invokeAsync instead`);
      }
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

  /** Invoke a possibly-async tool by name, recording the call (awaited duration).
   * Throws (after recording) if the tool throws or rejects. */
  async invokeAsync<R extends ToolResult>(
    name: string,
    args: Record<string, unknown>,
  ): Promise<R> {
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
      const result = (await tool.execute(args, this.ctx)) as R;
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

/** Registry pre-loaded with the tools available to the `glossary` skill. */
export function createGlossaryToolRegistry(fixtureRoot: string): ToolRegistry {
  const registry = new ToolRegistry({ fixtureRoot });
  registry.register(wikipediaSearchTool);
  registry.register(wikipediaFetchTool);
  return registry;
}

/** Registries pre-loaded with the tools of the Open Mind bridge skills. */
export function createOpenMindToolRegistry(skillName: string, fixtureRoot: string): ToolRegistry {
  const registry = new ToolRegistry({ fixtureRoot });
  switch (skillName) {
    case "openmind-glossary":
      registry.register(openMindGlossaryLookupTool).register(openMindTermUsageTool);
      break;
    case "openmind-code-graphs":
      registry.register(openMindSymbolDefinitionTool).register(openMindSymbolUsageTool);
      break;
    case "openmind-capability-router":
      registry.register(openMindRouteQueryTool).register(openMindCapabilityRegistryTool);
      break;
    default:
      throw new Error(`not an Open Mind skill: ${skillName}`);
  }
  return registry;
}

/**
 * Skill-aware tool registry factory. Each skill gets exactly the tools its
 * contract declares, all sharing one fixture root and one recording registry.
 */
export function createToolRegistry(skillName: string, fixtureRoot: string): ToolRegistry {
  switch (skillName) {
    case "glossary":
      return createGlossaryToolRegistry(fixtureRoot);
    case "openmind-glossary":
    case "openmind-code-graphs":
    case "openmind-capability-router":
      return createOpenMindToolRegistry(skillName, fixtureRoot);
    default:
      if (skillName.startsWith("specbridge-")) {
        return createSpecBridgeToolRegistry(fixtureRoot);
      }
      return createDefaultToolRegistry(fixtureRoot);
  }
}
