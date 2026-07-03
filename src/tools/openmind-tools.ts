import { readFileSync } from "node:fs";
import { resolveFromRoot } from "../core/paths.js";
import { getOpenMindBridge } from "./openmind-bridge.js";
import type { Tool, ToolContext, ToolResult } from "./tool-registry.js";

/**
 * Tools for the Open Mind skills. Except for `capability_registry` (a pure
 * fixture read), every tool is a thin recorded wrapper around the Open Mind
 * skill bridge — the answers come from Open Mind's real Python implementation,
 * not from a reimplementation in this repo. These tools are async; adapters
 * invoke them through `ToolRegistry.invokeAsync`.
 *
 * All file paths returned by these tools are repo-root-relative POSIX paths
 * (`<fixtureRoot>/<corpus-relative-path>`), ready to be used as citations.
 */

/** Prefix a corpus-relative path with the fixture root for citation use. */
function citePath(ctx: ToolContext, rel: string): string {
  return `${ctx.fixtureRoot}/${rel}`;
}

export interface GlossaryEntryResult extends ToolResult {
  found: boolean;
  term: string;
  definition: string;
  /** Repo-relative citation path (empty when not found). */
  file: string;
  line: number;
  snippet: string;
  sourceKind: string;
  message: string;
}

/** Exact-token glossary lookup via Open Mind's `glossary.get_glossary`. */
export const openMindGlossaryLookupTool: Tool<{ term: string }, GlossaryEntryResult> = {
  name: "glossary_lookup",
  description:
    "Resolve a term against Open Mind's deterministic glossary (exact token, verbatim definition, file:line provenance). Unknown terms return found=false, never a guess.",
  async execute({ term }, ctx) {
    const r = await getOpenMindBridge(ctx.fixtureRoot).request("glossary", term);
    const found = r.found === true;
    return {
      summary: found
        ? `"${String(r.term)}" -> ${String(r.source_file)}:${Number(r.line_number)} (${String(r.source_kind)})`
        : `"${term}" not found`,
      found,
      term: String(r.term ?? term),
      definition: String(r.definition ?? ""),
      file: found ? citePath(ctx, String(r.source_file)) : "",
      line: found ? Number(r.line_number) : 0,
      snippet: String(r.snippet ?? ""),
      sourceKind: String(r.source_kind ?? ""),
      message: String(r.message ?? ""),
    };
  },
};

export interface DefinitionSite {
  file: string;
  line: number;
  kind: string;
  snippet: string;
}

export interface UsageProfileResult extends ToolResult {
  term: string;
  isCodeSymbol: boolean;
  definedAt: DefinitionSite[];
  usedIn: string[];
  useCount: number;
  modules: string[];
}

function usageFromBridge(ctx: ToolContext, r: Record<string, unknown>): UsageProfileResult {
  const definedAt = ((r.defined_at as Record<string, unknown>[]) ?? []).map((d) => ({
    file: citePath(ctx, String(d.file)),
    line: Number(d.line),
    kind: String(d.kind ?? ""),
    snippet: String(d.snippet ?? ""),
  }));
  const usedIn = ((r.used_in as string[]) ?? []).map((p) => citePath(ctx, p));
  return {
    summary: `"${String(r.term)}": ${definedAt.length} definition site(s), used in ${usedIn.length} file(s)`,
    term: String(r.term ?? ""),
    isCodeSymbol: r.is_code_symbol === true,
    definedAt,
    usedIn,
    useCount: Number(r.use_count ?? 0),
    modules: (r.modules as string[]) ?? [],
  };
}

/** Grounded usage profile via Open Mind's `structure.term_usage`. */
export const openMindTermUsageTool: Tool<{ term: string }, UsageProfileResult> = {
  name: "term_usage",
  description:
    "Usage profile for a glossary term from Open Mind's deterministic structure map: definition sites (file:line:kind), referencing files, modules. Honestly empty for non-code terms.",
  async execute({ term }, ctx) {
    const r = await getOpenMindBridge(ctx.fixtureRoot).request("usage", term);
    return usageFromBridge(ctx, r);
  },
};

export interface SymbolDefinitionResult extends ToolResult {
  found: boolean;
  symbol: string;
  definitions: DefinitionSite[];
  message: string;
}

/** Symbol definition sites via Open Mind's `structure.get_definition`. */
export const openMindSymbolDefinitionTool: Tool<{ symbol: string }, SymbolDefinitionResult> = {
  name: "symbol_definition",
  description:
    "Resolve a code symbol to its definition site(s) from Open Mind's deterministic structure map. Unknown symbols return found=false, never an invented location.",
  async execute({ symbol }, ctx) {
    const r = await getOpenMindBridge(ctx.fixtureRoot).request("definition", symbol);
    const found = r.found === true;
    const definitions = found
      ? ((r.definitions as Record<string, unknown>[]) ?? []).map((d) => ({
          file: citePath(ctx, String(d.file)),
          line: Number(d.line),
          kind: String(d.kind ?? ""),
          snippet: String(d.snippet ?? ""),
        }))
      : [];
    return {
      summary: found
        ? `"${symbol}": ${definitions.length} definition site(s)`
        : `"${symbol}" not defined in the corpus`,
      found,
      symbol: String(r.symbol ?? symbol),
      definitions,
      message: String(r.message ?? ""),
    };
  },
};

/** Same bridge op as `term_usage`, under the code-graphs skill's tool name. */
export const openMindSymbolUsageTool: Tool<{ symbol: string }, UsageProfileResult> = {
  name: "symbol_usage",
  description:
    "Files that reference a code symbol, from Open Mind's deterministic name-based call/usage graph.",
  async execute({ symbol }, ctx) {
    const r = await getOpenMindBridge(ctx.fixtureRoot).request("usage", symbol);
    return usageFromBridge(ctx, r);
  },
};

export interface RouteResult extends ToolResult {
  capability: string;
  decidedBy: string;
  deterministicFallback: string;
  reason: string;
  capabilities: string[];
}

/** Deterministic capability routing via Open Mind's `router.route(use_model=False)`. */
export const openMindRouteQueryTool: Tool<{ query: string }, RouteResult> = {
  name: "route_query",
  description:
    "Route a query with Open Mind's capability router in deterministic-floor mode (no model). Always returns one of the known capabilities plus a full decision trace.",
  async execute({ query }, ctx) {
    const r = await getOpenMindBridge(ctx.fixtureRoot).request("route", query);
    return {
      summary: `"${query}" -> ${String(r.capability)} (${String(r.decided_by)})`,
      capability: String(r.capability ?? ""),
      decidedBy: String(r.decided_by ?? ""),
      deterministicFallback: String(r.deterministic_fallback ?? ""),
      reason: String(r.reason ?? ""),
      capabilities: (r.capabilities as string[]) ?? [],
    };
  },
};

export interface CapabilityRegistryResult extends ToolResult {
  found: boolean;
  capability: string;
  file: string;
  line: number;
  text: string;
}

/** Look a capability up in the corpus's documented registry (CAPABILITIES.md). */
export const openMindCapabilityRegistryTool: Tool<{ capability: string }, CapabilityRegistryResult> = {
  name: "capability_registry",
  description:
    "Find the fixture corpus's registry line documenting a capability. Grounds a routing decision: the chosen capability must exist in the documented set.",
  execute({ capability }, ctx) {
    const rel = "CAPABILITIES.md";
    const lines = readFileSync(resolveFromRoot(`${ctx.fixtureRoot}/${rel}`), "utf8").split(/\r?\n/);
    const idx = lines.findIndex((l) => l.trimStart().startsWith(`- ${capability}:`));
    const found = idx !== -1;
    return {
      summary: found ? `"${capability}" -> ${rel}:${idx + 1}` : `"${capability}" not in the registry`,
      found,
      capability,
      file: found ? citePath(ctx, rel) : "",
      line: found ? idx + 1 : 0,
      text: found ? lines[idx] : "",
    };
  },
};
