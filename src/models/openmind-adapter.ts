import type { Claim, ModelResponse, SkillOutput, ToolCall } from "../core/types.js";
import type {
  CapabilityRegistryResult,
  GlossaryEntryResult,
  RouteResult,
  SymbolDefinitionResult,
  UsageProfileResult,
} from "../tools/openmind-tools.js";
import { applyGlossaryFailureMode } from "./glossary-adapter.js";
import { buildPrompt, estimateUsage, hashSeed } from "./mock-adapter.js";
import type { ModelAdapter, ModelRunContext } from "./model-adapter.js";

/**
 * Adapter that runs the Open Mind capability skills — `openmind-glossary`,
 * `openmind-code-graphs`, `openmind-capability-router` — through the Open Mind
 * skill bridge. Unlike the mock adapters, the answers here are produced by Open
 * Mind's actual Python implementation (glossary extraction, structure map,
 * deterministic router floor); this adapter only parses the question, drives the
 * recorded tools, and shapes the bridge's grounded results into `SkillOutput`.
 *
 * Latency is real (measured wall clock over the bridge), not simulated. Token
 * usage remains an estimate — no language model is involved.
 */

/** Extract the term from a "define <term>" / "glossary <term>" / "what is <term>" question. */
export function parseGlossaryTerm(question: string): string {
  const q = String(question ?? "").trim();
  const m = q.match(/^(?:define|glossary|what\s+is)[\s:：]+(.+?)\??$/i);
  return (m ? m[1] : q).trim().replace(/^["'`]|["'`]$/g, "");
}

export type GraphQuery =
  | { kind: "definition"; symbol: string }
  | { kind: "usage"; symbol: string }
  | null;

/** Parse the two supported code-graphs question forms. */
export function parseGraphQuery(question: string): GraphQuery {
  const q = String(question ?? "").trim();
  let m = q.match(/^where\s+is\s+(\S+)\s+defined\??$/i);
  if (m) return { kind: "definition", symbol: m[1] };
  m = q.match(/^who\s+uses\s+(\S+)\??$/i);
  if (m) return { kind: "usage", symbol: m[1] };
  return null;
}

function reportedToolCalls(ctx: ModelRunContext): ToolCall[] {
  return ctx.tools.recordedCalls().map((c) => ({ tool: c.tool, arguments: c.arguments }));
}

function insufficient(ctx: ModelRunContext, answer: string): SkillOutput {
  return {
    status: "insufficient_evidence",
    answer,
    claims: [],
    toolCalls: reportedToolCalls(ctx),
    confidence: "low",
  };
}

async function glossaryOutput(ctx: ModelRunContext): Promise<SkillOutput> {
  const term = parseGlossaryTerm(ctx.input.question);
  const entry = await ctx.tools.invokeAsync<GlossaryEntryResult>("glossary_lookup", { term });
  ctx.logger.log("tool_call", { tool: "glossary_lookup", term, found: entry.found });
  if (!entry.found) {
    return insufficient(
      ctx,
      entry.message || `No authoritative definition found for "${term}" in the indexed corpus.`,
    );
  }

  const usage = await ctx.tools.invokeAsync<UsageProfileResult>("term_usage", { term: entry.term });
  ctx.logger.log("tool_call", { tool: "term_usage", term: entry.term, sites: usage.definedAt.length });

  const claims: Claim[] = [
    {
      text: `${entry.term}: ${entry.definition}`,
      citations: [{ file: entry.file, line: entry.line }],
    },
  ];
  if (usage.isCodeSymbol && usage.definedAt.length > 0) {
    const d = usage.definedAt[0];
    claims.push({
      text: `${entry.term} is declared in code at ${d.file} line ${d.line} (${d.kind}): ${d.snippet.trim()}`,
      citations: [{ file: d.file, line: d.line }],
    });
  }
  return {
    status: "answered",
    answer: `${entry.term} — ${entry.definition} (source: ${entry.file}:${entry.line})`,
    claims,
    toolCalls: reportedToolCalls(ctx),
    confidence: "high",
  };
}

async function codeGraphsOutput(ctx: ModelRunContext): Promise<SkillOutput> {
  const parsed = parseGraphQuery(ctx.input.question);
  if (!parsed) {
    return {
      status: "refused",
      answer:
        'Unsupported question form; ask "where is <symbol> defined" or "who uses <symbol>".',
      claims: [],
      toolCalls: reportedToolCalls(ctx),
      confidence: "low",
    };
  }

  const def = await ctx.tools.invokeAsync<SymbolDefinitionResult>("symbol_definition", {
    symbol: parsed.symbol,
  });
  ctx.logger.log("tool_call", { tool: "symbol_definition", symbol: parsed.symbol, found: def.found });
  if (!def.found) {
    return insufficient(
      ctx,
      def.message || `Symbol "${parsed.symbol}" is not defined in the indexed corpus.`,
    );
  }

  const defClaims: Claim[] = def.definitions.slice(0, 3).map((d) => ({
    text: `${parsed.symbol} is defined in ${d.file} at line ${d.line} (${d.kind}): ${d.snippet.trim()}`,
    citations: [{ file: d.file, line: d.line }],
  }));

  if (parsed.kind === "definition") {
    return {
      status: "answered",
      answer: `${parsed.symbol} is defined at ${def.definitions.length} site(s) in the corpus.`,
      claims: defClaims,
      toolCalls: reportedToolCalls(ctx),
      confidence: "high",
    };
  }

  const usage = await ctx.tools.invokeAsync<UsageProfileResult>("symbol_usage", {
    symbol: parsed.symbol,
  });
  ctx.logger.log("tool_call", { tool: "symbol_usage", symbol: parsed.symbol, usedIn: usage.usedIn.length });
  const anchor = def.definitions[0];
  const usageClaim: Claim = {
    text:
      usage.usedIn.length > 0
        ? `${parsed.symbol} is referenced by ${usage.usedIn.length} file(s): ${usage.usedIn.join(", ")}`
        : `${parsed.symbol} has no recorded cross-file usage sites in the corpus`,
    citations: [{ file: anchor.file, line: anchor.line }],
  };
  return {
    status: "answered",
    answer: `${parsed.symbol} is used in ${usage.usedIn.length} file(s); defined in ${anchor.file}.`,
    claims: [defClaims[0], usageClaim],
    toolCalls: reportedToolCalls(ctx),
    confidence: "high",
  };
}

async function routerOutput(ctx: ModelRunContext): Promise<SkillOutput> {
  const query = String(ctx.input.question ?? "");
  const route = await ctx.tools.invokeAsync<RouteResult>("route_query", { query });
  ctx.logger.log("tool_call", { tool: "route_query", capability: route.capability, decided_by: route.decidedBy });

  const reg = ctx.tools.invoke<CapabilityRegistryResult>("capability_registry", {
    capability: route.capability,
  });
  // A capability outside the documented registry yields an uncited claim, which
  // the unsupported-claim validator rejects — the fabrication tripwire.
  const claims: Claim[] = [
    {
      text: `routed to capability: ${route.capability} — ${reg.text.trim() || "(not in the documented registry)"}`,
      citations: reg.found ? [{ file: reg.file, line: reg.line }] : [],
    },
  ];
  return {
    status: "answered",
    answer:
      `capability: ${route.capability}; decided_by: ${route.decidedBy}; ` +
      `deterministic_fallback: ${route.deterministicFallback}; reason: ${route.reason}`,
    claims,
    toolCalls: reportedToolCalls(ctx),
    confidence: "high",
  };
}

/** Produce the grounded output for whichever Open Mind skill is under eval. */
export async function buildOpenMindOutput(ctx: ModelRunContext): Promise<SkillOutput> {
  const generation = ctx.tracer.startSpan("output.generation", {
    "skill.name": ctx.skill.name,
  });
  try {
    let output: SkillOutput;
    switch (ctx.skill.name) {
      case "openmind-glossary":
        output = await glossaryOutput(ctx);
        break;
      case "openmind-code-graphs":
        output = await codeGraphsOutput(ctx);
        break;
      case "openmind-capability-router":
        output = await routerOutput(ctx);
        break;
      default:
        throw new Error(`openmind adapter does not support skill "${ctx.skill.name}"`);
    }
    generation.setAttribute("decision", output.status);
    generation.end();
    return output;
  } catch (error) {
    generation.end("error");
    throw error;
  }
}

export class OpenMindAdapter implements ModelAdapter {
  readonly name = "openmind";
  readonly type = "openmind-python-bridge";

  async generate(ctx: ModelRunContext): Promise<ModelResponse> {
    const output = await buildOpenMindOutput(ctx);
    const usage = estimateUsage(buildPrompt(ctx), output);
    ctx.logger.log("model_response", { status: output.status, confidence: output.confidence });
    return { output, usage };
  }
}

/**
 * Flaky twin: produces the correct bridge-grounded output first, then
 * deterministically perturbs it per run seed with the same failure modes the
 * glossary flaky adapter uses (dropped citations, shifted line, invalid status,
 * reversed tool order, invented uncited claim). Exists to prove the validators
 * catch bad outputs from this integration too.
 */
export class OpenMindFlakyAdapter implements ModelAdapter {
  readonly name = "openmind-flaky";
  readonly type = "openmind-python-bridge-unstable";

  async generate(ctx: ModelRunContext): Promise<ModelResponse> {
    const good = await buildOpenMindOutput(ctx);
    const mode = hashSeed(`${ctx.seed}:mode`) % 8;
    const { output, failureMode } = applyGlossaryFailureMode(good, mode);
    const usage = estimateUsage(buildPrompt(ctx), output);
    ctx.logger.log("model_response", {
      status: (output as { status: string }).status,
      failure_mode: failureMode,
    });
    return { output, usage };
  }
}
