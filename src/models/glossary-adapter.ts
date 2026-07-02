import type { ModelResponse, SkillOutput, ToolCall } from "../core/types.js";
import type { WikipediaSearchResult } from "../tools/wikipedia-search-tool.js";
import type { WikipediaFetchResult } from "../tools/wikipedia-fetch-tool.js";
import { buildPrompt, estimateUsage, hashSeed, simulateLatency } from "./mock-adapter.js";
import type { ModelAdapter, ModelRunContext } from "./model-adapter.js";

/**
 * Offline, deterministic reference adapter for the `glossary` skill.
 *
 * It parses "glossary <term>" from the question, uses the same `wikipedia_search`
 * → `wikipedia_fetch` tools a real model would, and produces a source-grounded
 * answer whose single claim cites the exact line of the offline Wikipedia
 * snapshot that carries the term. Like the codebase mock adapter, it is genuinely
 * grounded (citations are recomputed from the fixtures every run) and fully
 * deterministic, which is what keeps the report reproducible and CI stable.
 *
 * The polished web-page deliverable is rendered from the same grounded snapshot
 * by `src/skills/glossary/render.ts` (see `src/cli/run-glossary.ts`).
 */

/** Extract the search term from a "glossary <term>" question. */
export function parseTerm(question: string): string {
  const q = String(question ?? "").trim();
  const m = q.match(/^glossary[\s:：]+(.+)$/i);
  return (m ? m[1] : q).trim();
}

function reportedToolCalls(ctx: ModelRunContext): ToolCall[] {
  return ctx.tools.recordedCalls().map((c) => ({ tool: c.tool, arguments: c.arguments }));
}

/** Produce a valid, source-grounded glossary output for the given context. */
export function buildGlossaryOutput(ctx: ModelRunContext): SkillOutput {
  const term = parseTerm(ctx.input.question);

  const selection = ctx.tracer.startSpan("tool.selection", {
    "skill.name": ctx.skill.name,
    "glossary.term": term,
  });
  ctx.logger.log("tool_selection", { term });
  selection.end();

  const execution = ctx.tracer.startSpan("tool.execution", {});
  const search = ctx.tools.invoke<WikipediaSearchResult>("wikipedia_search", { query: term });
  ctx.logger.log("tool_call", {
    tool: "wikipedia_search",
    query: term,
    matches: search.matches.length,
  });

  if (search.files.length === 0) {
    execution.setAttribute("snapshots.matched", 0);
    execution.end();
    const generation = ctx.tracer.startSpan("output.generation", {});
    generation.setAttribute("decision", "insufficient_evidence");
    ctx.logger.log("output_generated", { status: "insufficient_evidence", term });
    generation.end();
    return {
      status: "insufficient_evidence",
      answer: `No Wikipedia snapshot found for "${term}"; cannot provide a source-grounded definition.`,
      claims: [],
      toolCalls: reportedToolCalls(ctx),
      confidence: "low",
    };
  }

  const bestFile = search.files[0];
  const page = ctx.tools.invoke<WikipediaFetchResult>("wikipedia_fetch", { path: bestFile });
  ctx.logger.log("tool_call", { tool: "wikipedia_fetch", path: bestFile, title: page.title });
  execution.setAttribute("snapshots.matched", search.files.length);
  execution.end();

  const firstSentence = page.data.sentences[0] ?? page.extract;
  const desc = page.description || "Wikipedia entry";
  const claimText = `${term} (Wikipedia article: ${page.title}) — ${desc}.`;
  const answer = `${term} — ${desc}. ${firstSentence}`;

  const generation = ctx.tracer.startSpan("output.generation", {});
  const output: SkillOutput = {
    status: "answered",
    answer,
    claims: [
      {
        text: claimText,
        citations: [{ file: page.path, line: page.ledeLine }],
      },
    ],
    toolCalls: reportedToolCalls(ctx),
    confidence: "high",
  };
  generation.setAttribute("decision", "answered");
  generation.setAttribute("citation.file", page.path);
  generation.setAttribute("citation.line", page.ledeLine);
  ctx.logger.log("output_generated", {
    status: "answered",
    file: page.path,
    line: page.ledeLine,
    title: page.title,
  });
  generation.end();
  return output;
}

export class GlossaryAdapter implements ModelAdapter {
  readonly name = "glossary";
  readonly type = "offline-deterministic";

  async generate(ctx: ModelRunContext): Promise<ModelResponse> {
    const output = buildGlossaryOutput(ctx);
    const usage = estimateUsage(buildPrompt(ctx), output);
    const simulatedLatencyMs = simulateLatency(ctx.seed, 60, 120);
    ctx.logger.log("model_response", {
      status: output.status,
      latency_ms: simulatedLatencyMs,
      confidence: output.confidence,
    });
    return { output, usage, simulatedLatencyMs };
  }
}

/** Failure modes for the flaky glossary adapter — one per validator. */
export type GlossaryFailureMode =
  | "none"
  | "dropped_citations"
  | "wrong_line"
  | "invalid_schema"
  | "wrong_tool_order"
  | "unsupported_claim";

export function applyGlossaryFailureMode(
  good: SkillOutput,
  mode: number,
): { output: SkillOutput; failureMode: GlossaryFailureMode } {
  const clone: SkillOutput = structuredClone(good);
  // Only answered outputs are perturbable; pass through the rest untouched.
  if (clone.status !== "answered") return { output: clone, failureMode: "none" };

  switch (mode) {
    case 0:
    case 1:
    case 2:
      return { output: clone, failureMode: "none" };
    case 3:
      clone.claims = clone.claims.map((c) => ({ ...c, citations: [] }));
      return { output: clone, failureMode: "dropped_citations" };
    case 4:
      clone.claims = clone.claims.map((c) => ({
        ...c,
        citations: c.citations.map((ci) => ({ ...ci, line: ci.line + 7 })),
      }));
      return { output: clone, failureMode: "wrong_line" };
    case 5:
      (clone as unknown as { status: string }).status = "maybe";
      return { output: clone, failureMode: "invalid_schema" };
    case 6:
      clone.toolCalls = [...clone.toolCalls].reverse();
      return { output: clone, failureMode: "wrong_tool_order" };
    case 7:
    default:
      clone.claims = [
        ...clone.claims,
        { text: "Its official language is Esperanto.", citations: [] },
      ];
      return { output: clone, failureMode: "unsupported_claim" };
  }
}

export class GlossaryFlakyAdapter implements ModelAdapter {
  readonly name = "glossary-flaky";
  readonly type = "offline-deterministic-unstable";

  async generate(ctx: ModelRunContext): Promise<ModelResponse> {
    const good = buildGlossaryOutput(ctx);
    const mode = hashSeed(`${ctx.seed}:mode`) % 8;
    const { output, failureMode } = applyGlossaryFailureMode(good, mode);

    const usage = estimateUsage(buildPrompt(ctx), output);
    const spike = mode === 4 || mode === 7 ? 170 : 0;
    const simulatedLatencyMs = simulateLatency(ctx.seed, 70, 130) + spike;
    ctx.logger.log("model_response", {
      status: (output as { status: string }).status,
      failure_mode: failureMode,
      latency_ms: simulatedLatencyMs,
    });
    return { output, usage, simulatedLatencyMs };
  }
}
