import type { ModelResponse, SkillOutput, TokenUsage, ToolCall } from "../core/types.js";
import type { ReadFileResult } from "../tools/read-file-tool.js";
import type { RepoSearchResult } from "../tools/repo-search-tool.js";
import type { ModelAdapter, ModelRunContext } from "./model-adapter.js";

/**
 * Offline, deterministic mock adapter.
 *
 * This adapter is genuinely source-grounded: it uses the same `repo_search` and
 * `read_file` tools a real model would, and its citations are recomputed from the
 * fixture repo on every run. Given identical inputs it always produces identical
 * output, which is what makes reports reproducible and CI stable. Token counts,
 * latency, and cost are ESTIMATED/DEMO values (see docs/model-adapters.md).
 *
 * The core grounding routine is exported so the flaky adapter can reuse it and
 * then perturb the result to demonstrate failure reporting.
 */

// Generic English + domain-generic words that carry no locating signal here.
const STOPWORDS = new Set([
  "which",
  "what",
  "does",
  "done",
  "this",
  "that",
  "these",
  "those",
  "with",
  "from",
  "into",
  "about",
  "your",
  "their",
  "there",
  "here",
  "then",
  "than",
  "only",
  "also",
  "some",
  "have",
  "been",
  "will",
  "would",
  "should",
  "could",
  "must",
  "might",
  "service",
  "services",
  "component",
  "components",
  "file",
  "files",
  "class",
  "classes",
  "method",
  "methods",
  "function",
  "functions",
  "handle",
  "handles",
  "handled",
  "code",
  "project",
  "repo",
  "repository",
  "system",
  "systems",
  "using",
  "used",
  "uses",
  "part",
  "parts",
  "thing",
  "things",
  "please",
  "tell",
  "show",
  "give",
  "find",
]);

/** FNV-1a hash for cheap deterministic pseudo-randomness (no Math.random). */
export function hashSeed(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Deterministic value in [0, 1) derived from a seed string. */
export function unit(seed: string): number {
  return (hashSeed(seed) % 100000) / 100000;
}

function uniq(items: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const it of items) {
    if (!seen.has(it)) {
      seen.add(it);
      out.push(it);
    }
  }
  return out;
}

export interface ExtractedTerms {
  strong: string[];
  weak: string[];
}

/**
 * Split a question into "strong" terms (CamelCase identifiers, high signal) and
 * "weak" terms (ordinary keywords). Strong terms alone justify an answer; weak
 * terms need at least two distinct matches in a single file.
 */
export function extractTerms(question: string): ExtractedTerms {
  const strongRe = /\b[A-Z][a-z0-9]+(?:[A-Z][a-z0-9]*)+\b/g;
  const strong = uniq(question.match(strongRe) ?? []);

  let remainder = question;
  for (const s of strong) remainder = remainder.split(s).join(" ");

  const words = remainder.toLowerCase().match(/[a-z][a-z0-9]+/g) ?? [];
  const weak = uniq(words.filter((w) => w.length >= 4 && !STOPWORDS.has(w)));

  return { strong, weak };
}

/** A build-up of evidence for a single file, accumulated from search hits. */
interface FileAccumulator {
  file: string;
  strong: Set<string>;
  weak: Set<string>;
  strongLines: number;
  weakLines: number;
  lineTerms: Map<number, Set<string>>;
}

function score(f: FileAccumulator): number {
  return f.strongLines * 10 + f.weakLines;
}

/** Pick the most evidence-dense line: most terms, prefer a strong term, then earliest. */
function chooseBestLine(f: FileAccumulator): number {
  let best: { line: number; size: number; hasStrong: boolean } | null = null;
  for (const [line, terms] of f.lineTerms) {
    const hasStrong = [...terms].some((t) => f.strong.has(t));
    const cand = { line, size: terms.size, hasStrong };
    const better =
      !best ||
      cand.size > best.size ||
      (cand.size === best.size && cand.hasStrong && !best.hasStrong) ||
      (cand.size === best.size && cand.hasStrong === best.hasStrong && cand.line < best.line);
    if (better) best = cand;
  }
  return best ? best.line : 1;
}

function reportedToolCalls(ctx: ModelRunContext): ToolCall[] {
  return ctx.tools.recordedCalls().map((c) => ({ tool: c.tool, arguments: c.arguments }));
}

/**
 * Produce a valid, source-grounded skill output for the given context. Emits the
 * tool.selection / tool.execution / output.generation spans and structured logs.
 */
export function buildGroundedOutput(ctx: ModelRunContext): SkillOutput {
  const question = ctx.input.question;
  const terms = extractTerms(question);

  const selection = ctx.tracer.startSpan("tool.selection", {
    "skill.name": ctx.skill.name,
    "terms.strong": terms.strong.join(","),
    "terms.weak": terms.weak.join(","),
  });
  ctx.logger.log("tool_selection", { strong_terms: terms.strong, weak_terms: terms.weak });
  selection.end();

  const files = new Map<string, FileAccumulator>();
  const ensure = (file: string): FileAccumulator => {
    let acc = files.get(file);
    if (!acc) {
      acc = {
        file,
        strong: new Set(),
        weak: new Set(),
        strongLines: 0,
        weakLines: 0,
        lineTerms: new Map(),
      };
      files.set(file, acc);
    }
    return acc;
  };

  const execution = ctx.tracer.startSpan("tool.execution", {});
  const searchTerms = [
    ...terms.strong.map((term) => ({ term, strong: true })),
    ...terms.weak.map((term) => ({ term, strong: false })),
  ];
  for (const { term, strong } of searchTerms) {
    const result = ctx.tools.invoke<RepoSearchResult>("repo_search", { query: term });
    ctx.logger.log("tool_call", { tool: "repo_search", query: term, matches: result.matches.length });
    for (const m of result.matches) {
      const acc = ensure(m.file);
      if (strong) {
        acc.strong.add(term);
        acc.strongLines++;
      } else {
        acc.weak.add(term);
        acc.weakLines++;
      }
      const set = acc.lineTerms.get(m.line) ?? new Set<string>();
      set.add(term);
      acc.lineTerms.set(m.line, set);
    }
  }
  execution.setAttribute("files.matched", files.size);
  execution.end();

  const eligible = [...files.values()].filter((f) => f.strong.size >= 1 || f.weak.size >= 2);
  const generation = ctx.tracer.startSpan("output.generation", {});

  if (eligible.length === 0) {
    generation.setAttribute("decision", "insufficient_evidence");
    ctx.logger.log("output_generated", { status: "insufficient_evidence" });
    generation.end();
    return {
      status: "insufficient_evidence",
      answer:
        "The repository does not contain clear evidence to answer this question with source-grounded citations.",
      claims: [],
      toolCalls: reportedToolCalls(ctx),
      confidence: "low",
    };
  }

  const best = eligible.sort((a, b) => score(b) - score(a) || a.file.localeCompare(b.file))[0];

  // Read the winning file to confirm the evidence (records a read_file tool call).
  ctx.tools.invoke<ReadFileResult>("read_file", { path: best.file });
  ctx.logger.log("tool_call", { tool: "read_file", path: best.file });

  const bestLine = chooseBestLine(best);
  const weakByLength = [...best.weak].sort((a, b) => b.length - a.length);
  const matched = [...best.strong, ...weakByLength];
  const primary = [...matched].sort((a, b) => b.length - a.length)[0] ?? matched[0];
  const baseName = best.file.split("/").pop() ?? best.file;

  const output: SkillOutput = {
    status: "answered",
    answer: `${primary} is handled in ${baseName}. See ${best.file}:${bestLine}.`,
    claims: [
      {
        text: `${baseName} is the source for ${matched.join(", ")}.`,
        citations: [{ file: best.file, line: bestLine }],
      },
    ],
    toolCalls: reportedToolCalls(ctx),
    confidence: best.strong.size > 0 ? "high" : "medium",
  };

  generation.setAttribute("decision", "answered");
  generation.setAttribute("citation.file", best.file);
  generation.setAttribute("citation.line", bestLine);
  ctx.logger.log("output_generated", { status: "answered", file: best.file, line: bestLine });
  generation.end();
  return output;
}

export function buildPrompt(ctx: ModelRunContext): string {
  return [
    `Skill: ${ctx.skill.name} v${ctx.skill.version}`,
    ctx.skill.description,
    `Citation requirement: ${ctx.skill.citationRequirement}`,
    `Unsupported-claim policy: ${ctx.skill.unsupportedClaimPolicy}`,
    `Tools: ${ctx.skill.tools.map((t) => t.name).join(", ")}`,
    `Question: ${ctx.input.question}`,
  ].join("\n");
}

/** Rough token estimate (~4 chars/token). Clearly labeled as estimated. */
export function estimateUsage(prompt: string, output: SkillOutput): TokenUsage {
  const approx = (s: string): number => Math.max(1, Math.ceil(s.length / 4));
  return {
    inputTokens: approx(prompt),
    outputTokens: approx(JSON.stringify(output)),
    estimated: true,
  };
}

/** Deterministic, reproducible latency for demo reports. */
export function simulateLatency(seed: string, baseMs: number, rangeMs: number): number {
  return Math.round(baseMs + unit(`${seed}:lat`) * rangeMs);
}

export class MockAdapter implements ModelAdapter {
  readonly name = "mock";
  readonly type = "offline-deterministic";

  async generate(ctx: ModelRunContext): Promise<ModelResponse> {
    const output = buildGroundedOutput(ctx);
    const usage = estimateUsage(buildPrompt(ctx), output);
    const simulatedLatencyMs = simulateLatency(ctx.seed, 45, 110);
    ctx.logger.log("model_response", {
      status: output.status,
      latency_ms: simulatedLatencyMs,
      confidence: output.confidence,
    });
    return { output, usage, simulatedLatencyMs };
  }
}
