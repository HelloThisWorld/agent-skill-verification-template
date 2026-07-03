import { z } from "zod";
import type { ModelResponse, SkillOutput, TokenUsage, ToolCall } from "../core/types.js";
import type { ToolDescription } from "../tools/tool-registry.js";
import { estimateUsage, hashSeed } from "./mock-adapter.js";
import type { ModelAdapter, ModelRunContext } from "./model-adapter.js";

/**
 * Live model adapter — the first adapter in this repo where a real language
 * model produces the skill output.
 *
 * It speaks the OpenAI-compatible chat-completions protocol, which covers:
 *   - a local llama.cpp `llama-server` (default, `http://127.0.0.1:8080/v1`),
 *   - a local Ollama server (`http://127.0.0.1:11434/v1`, requires LLM_MODEL),
 *   - any remote OpenAI-compatible API (set LLM_BASE_URL, LLM_MODEL, LLM_API_KEY).
 *
 * The adapter drives a bounded tool loop: the model must reply with exactly one
 * JSON action per turn — either a tool call (executed through the recording
 * ToolRegistry, so validators grade what the model actually did) or the final
 * `SkillOutput`. Nothing from the grading key (expected status, required
 * symbols, forbidden claims) is ever shown to the model.
 *
 * Resource safety: requests are strictly sequential (the eval runner already
 * serializes attempts), every HTTP call has a hard AbortController timeout,
 * the loop is capped at LLM_MAX_ROUNDS, and generation is capped at
 * LLM_MAX_TOKENS — a wedged server or a runaway generation fails one run
 * instead of hanging the eval or pinning the GPU indefinitely.
 *
 * Latency is real wall-clock time (the adapter never sets simulatedLatencyMs)
 * and token usage is provider-reported when available (`estimated: false`).
 */

/** All knobs come from the environment so nothing is hardcoded. */
export interface LlmConfig {
  /** OpenAI-compatible base URL ending in /v1 (trailing slash tolerated). */
  baseUrl: string;
  /** Model name/tag. Optional for llama.cpp (single loaded model); required by Ollama/remote APIs. */
  model: string;
  /** Bearer token for remote APIs. Local servers do not need one. */
  apiKey: string;
  temperature: number;
  maxTokens: number;
  timeoutMs: number;
  /** Max model turns per run (tool calls + final answer). */
  maxRounds: number;
  /**
   * How structured output is enforced:
   *  - "schema": response_format json_schema (grammar-constrained on llama.cpp) — best locally
   *  - "object": response_format json_object — widest remote-API compatibility
   *  - "off":    prompt-only (adapter still extracts the first JSON object)
   * On HTTP 400 the adapter downgrades schema → object → off automatically.
   */
  jsonMode: "schema" | "object" | "off";
}

const DEFAULTS = {
  baseUrl: "http://127.0.0.1:8080/v1",
  temperature: 0,
  // Grammar-constrained decoding can pad heavily with whitespace, so a final
  // answer with a few claims needs real headroom before it stops truncating.
  maxTokens: 2048,
  timeoutMs: 180_000,
  maxRounds: 8,
  jsonMode: "schema" as const,
};

function numFromEnv(value: string | undefined, fallback: number, name: string): number {
  if (value === undefined || value === "") return fallback;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) throw new Error(`${name} must be a non-negative number (got "${value}")`);
  return n;
}

export function resolveLlmConfig(env: NodeJS.ProcessEnv = process.env): LlmConfig {
  const jsonMode = (env.LLM_JSON_MODE ?? DEFAULTS.jsonMode) as LlmConfig["jsonMode"];
  if (!["schema", "object", "off"].includes(jsonMode)) {
    throw new Error(`LLM_JSON_MODE must be one of schema | object | off (got "${jsonMode}")`);
  }
  return {
    baseUrl: (env.LLM_BASE_URL ?? DEFAULTS.baseUrl).replace(/\/+$/, ""),
    model: env.LLM_MODEL ?? "",
    apiKey: env.LLM_API_KEY ?? "",
    temperature: numFromEnv(env.LLM_TEMPERATURE, DEFAULTS.temperature, "LLM_TEMPERATURE"),
    maxTokens: numFromEnv(env.LLM_MAX_TOKENS, DEFAULTS.maxTokens, "LLM_MAX_TOKENS"),
    timeoutMs: numFromEnv(env.LLM_TIMEOUT_MS, DEFAULTS.timeoutMs, "LLM_TIMEOUT_MS"),
    maxRounds: Math.max(1, Math.floor(numFromEnv(env.LLM_MAX_ROUNDS, DEFAULTS.maxRounds, "LLM_MAX_ROUNDS"))),
    jsonMode,
  };
}

/* ------------------------------------------------------------------ *
 * Action protocol
 * ------------------------------------------------------------------ */

export type ParsedAction =
  | { kind: "tool"; tool: string; arguments: Record<string, unknown> }
  | { kind: "final"; output: Record<string, unknown> }
  | { kind: "invalid"; error: string };

const toolActionSchema = z.object({
  action: z.literal("tool"),
  tool: z.string().min(1),
  arguments: z.record(z.unknown()).default({}),
});

const finalActionSchema = z.object({
  action: z.literal("final"),
  output: z.record(z.unknown()),
});

/**
 * Extract the first complete JSON object from model text, tolerating markdown
 * fences and prose around it. Returns null when no balanced object is found.
 */
export function extractJson(text: string): string | null {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fenced ? fenced[1] : text;
  const start = body.indexOf("{");
  if (start === -1) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < body.length; i++) {
    const ch = body[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return body.slice(start, i + 1);
    }
  }
  return null;
}

export function parseAction(text: string): ParsedAction {
  const json = extractJson(text);
  if (!json) return { kind: "invalid", error: "no JSON object found in the reply" };
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch (error) {
    return { kind: "invalid", error: `JSON parse error: ${error instanceof Error ? error.message : String(error)}` };
  }
  const asTool = toolActionSchema.safeParse(raw);
  if (asTool.success) {
    return { kind: "tool", tool: asTool.data.tool, arguments: asTool.data.arguments };
  }
  const asFinal = finalActionSchema.safeParse(raw);
  if (asFinal.success) {
    return { kind: "final", output: asFinal.data.output };
  }
  return {
    kind: "invalid",
    error: 'JSON must be {"action":"tool","tool":...,"arguments":{...}} or {"action":"final","output":{...}}',
  };
}

/* ------------------------------------------------------------------ *
 * Prompt construction
 * ------------------------------------------------------------------ */

function toolDocLines(doc: ToolDescription): string {
  const params =
    Object.keys(doc.parameters).length > 0
      ? Object.entries(doc.parameters)
          .map(([k, v]) => `"${k}": ${v}`)
          .join(", ")
      : "see description";
  return `- ${doc.name}: ${doc.description}\n  arguments: { ${params} }`;
}

/**
 * The system prompt is the skill contract rendered as instructions plus the
 * action protocol. It is built only from the contract and the live tool
 * registry — never from the test case's grading fields.
 */
export function buildSystemPrompt(ctx: ModelRunContext, tools: ToolDescription[]): string {
  const contract = ctx.skill;
  const requiredTools = contract.tools.filter((t) => t.required).map((t) => t.name);
  const toolContractLines: string[] = [];
  if (requiredTools.length > 0) {
    toolContractLines.push(
      `- Required tools: you MUST call ${requiredTools.join(" and ")} — each at least once — before giving the final answer.`,
    );
  }
  if (contract.toolOrder.length > 1) {
    toolContractLines.push(`- Required tool order: ${contract.toolOrder.join(" before ")}.`);
  }
  return [
    `You are the execution engine for the agent skill "${contract.name}" v${contract.version}.`,
    contract.description,
    "",
    "Contract:",
    `- Citation requirement: ${contract.citationRequirement}`,
    `- Unsupported-claim policy: ${contract.unsupportedClaimPolicy}`,
    `- Failure behavior: ${contract.failureBehavior}`,
    ...toolContractLines,
    "",
    "Available tools:",
    ...tools.map(toolDocLines),
    "",
    "Protocol — every reply MUST be exactly one JSON object. No prose, no markdown, no comments.",
    'To call a tool:  {"action":"tool","tool":"<name>","arguments":{...}}',
    'To answer:       {"action":"final","output":{"status":"answered"|"insufficient_evidence"|"refused","answer":"<short answer>","claims":[{"text":"<factual claim>","citations":[{"file":"<path>","line":<number>}]}],"confidence":"low"|"medium"|"high"}}',
    "",
    "Rules:",
    "- Use the tools to gather evidence BEFORE answering. Never answer from memory; tool results are the only source of truth.",
    '- Copy citation "file" and "line" values EXACTLY from tool results (fields named file/path and line/ledeLine). Never invent or adjust them.',
    '- If the tools return no evidence for the request, reply with status "insufficient_evidence", an empty claims array, and state no facts about the subject.',
    "- Each claim must be one short factual statement supported by its cited line.",
    '- Do not include a "toolCalls" field in the final output; tool calls are recorded automatically.',
  ].join("\n");
}

/** JSON schema for the action envelope (grammar-enforced on llama.cpp in "schema" mode). */
export function actionJsonSchema(toolNames: string[]): Record<string, unknown> {
  return {
    oneOf: [
      {
        type: "object",
        properties: {
          action: { const: "tool" },
          tool: toolNames.length > 0 ? { type: "string", enum: toolNames } : { type: "string" },
          arguments: { type: "object" },
        },
        required: ["action", "tool", "arguments"],
      },
      {
        type: "object",
        properties: {
          action: { const: "final" },
          output: {
            type: "object",
            properties: {
              status: { type: "string", enum: ["answered", "insufficient_evidence", "refused"] },
              answer: { type: "string" },
              claims: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    text: { type: "string" },
                    citations: {
                      type: "array",
                      items: {
                        type: "object",
                        properties: { file: { type: "string" }, line: { type: "integer" } },
                        required: ["file", "line"],
                      },
                    },
                  },
                  required: ["text", "citations"],
                },
              },
              confidence: { type: "string", enum: ["low", "medium", "high"] },
            },
            required: ["status", "answer", "claims"],
          },
        },
        required: ["action", "output"],
      },
    ],
  };
}

/* ------------------------------------------------------------------ *
 * Tool-result compaction (keeps prompts bounded)
 * ------------------------------------------------------------------ */

const MAX_STRING = 500;
const MAX_ARRAY = 20;
const MAX_TOTAL = 6000;

function compactValue(value: unknown): unknown {
  if (typeof value === "string") {
    return value.length > MAX_STRING ? `${value.slice(0, MAX_STRING)}…[truncated]` : value;
  }
  if (Array.isArray(value)) {
    const head = value.slice(0, MAX_ARRAY).map(compactValue);
    if (value.length > MAX_ARRAY) head.push(`…[${value.length - MAX_ARRAY} more items truncated]`);
    return head;
  }
  if (typeof value === "object" && value !== null) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = compactValue(v);
    return out;
  }
  return value;
}

/** Serialize a tool result for the prompt: long strings/arrays truncated, total size capped. */
export function compactToolResult(result: unknown): string {
  const json = JSON.stringify(compactValue(result));
  return json.length > MAX_TOTAL ? `${json.slice(0, MAX_TOTAL)}…[truncated]` : json;
}

/* ------------------------------------------------------------------ *
 * Output shaping
 * ------------------------------------------------------------------ */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Guarantee the container shapes validators iterate over (claims/citations
 * arrays, string claim text) WITHOUT repairing the model's answer: wrong
 * status values, missing answers, bad line numbers etc. pass through untouched
 * so the schema/citation validators grade them honestly. `toolCalls` is always
 * the registry's recorded trace — the ground truth of what the model did.
 */
export function coerceOutput(raw: unknown, toolCalls: ToolCall[]): SkillOutput {
  const obj = isRecord(raw) ? raw : {};
  const claims = Array.isArray(obj.claims)
    ? obj.claims.filter(isRecord).map((c) => ({
        ...c,
        text: typeof c.text === "string" ? c.text : "",
        citations: Array.isArray(c.citations) ? c.citations.filter(isRecord) : [],
      }))
    : [];
  return { ...obj, claims, toolCalls } as unknown as SkillOutput;
}

/* ------------------------------------------------------------------ *
 * The adapter
 * ------------------------------------------------------------------ */

interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

interface ChatResult {
  content: string;
  promptTokens?: number;
  completionTokens?: number;
  /** OpenAI finish_reason; "length" means the reply was truncated at max_tokens. */
  finishReason?: string;
}

export class LlmAdapter implements ModelAdapter {
  readonly name = "llm";
  readonly type = "openai-compatible-live";

  private readonly cfg: LlmConfig;
  /** Current enforcement mode; downgraded at runtime if the server rejects it. */
  private jsonMode: LlmConfig["jsonMode"];
  private preflightPromise?: Promise<void>;

  constructor(cfg: LlmConfig = resolveLlmConfig()) {
    this.cfg = cfg;
    this.jsonMode = cfg.jsonMode;
  }

  /** One-time reachability check with an actionable error message. */
  private preflight(): Promise<void> {
    this.preflightPromise ??= (async () => {
      const url = `${this.cfg.baseUrl}/models`;
      try {
        const res = await this.fetchWithTimeout(url, { method: "GET" }, 10_000);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        throw new Error(
          [
            `Cannot reach the model server at ${this.cfg.baseUrl} (${reason}).`,
            "- Local llama.cpp: start it first (e.g. scripts/start-eval-llm.ps1) or point LLM_BASE_URL at it.",
            "- Ollama: set LLM_BASE_URL=http://127.0.0.1:11434/v1 and LLM_MODEL=<tag>.",
            "- Remote API: set LLM_BASE_URL, LLM_MODEL and LLM_API_KEY.",
          ].join("\n"),
        );
      }
    })();
    return this.preflightPromise;
  }

  private async fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const headers: Record<string, string> = { "content-type": "application/json" };
      if (this.cfg.apiKey) headers.authorization = `Bearer ${this.cfg.apiKey}`;
      return await fetch(url, { ...init, headers, signal: controller.signal });
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw new Error(`request timed out after ${timeoutMs} ms`);
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  private responseFormat(schema: Record<string, unknown>): Record<string, unknown> | undefined {
    if (this.jsonMode === "schema") {
      return { type: "json_schema", json_schema: { name: "skill_action", schema } };
    }
    if (this.jsonMode === "object") return { type: "json_object" };
    return undefined;
  }

  private async chat(
    messages: ChatMessage[],
    schema: Record<string, unknown>,
    seed: number,
  ): Promise<ChatResult> {
    // Downgrade chain on HTTP 400: schema → object → off. Some servers/providers
    // reject one enforcement style but accept the next weaker one.
    for (;;) {
      const body: Record<string, unknown> = {
        messages,
        temperature: this.cfg.temperature,
        max_tokens: this.cfg.maxTokens,
        stream: false,
        seed,
      };
      if (this.cfg.model) body.model = this.cfg.model;
      const rf = this.responseFormat(schema);
      if (rf) body.response_format = rf;

      const res = await this.fetchWithTimeout(
        `${this.cfg.baseUrl}/chat/completions`,
        { method: "POST", body: JSON.stringify(body) },
        this.cfg.timeoutMs,
      );

      if (!res.ok) {
        const text = (await res.text().catch(() => "")).slice(0, 400);
        if (res.status === 400 && this.jsonMode !== "off") {
          this.jsonMode = this.jsonMode === "schema" ? "object" : "off";
          continue;
        }
        throw new Error(`LLM request failed: HTTP ${res.status} ${text}`);
      }

      const data = (await res.json()) as {
        choices?: { message?: { content?: string }; finish_reason?: string }[];
        usage?: { prompt_tokens?: number; completion_tokens?: number };
      };
      const content = data.choices?.[0]?.message?.content;
      if (typeof content !== "string") {
        throw new Error("LLM response had no message content");
      }
      return {
        content,
        promptTokens: typeof data.usage?.prompt_tokens === "number" ? data.usage.prompt_tokens : undefined,
        completionTokens:
          typeof data.usage?.completion_tokens === "number" ? data.usage.completion_tokens : undefined,
        finishReason: data.choices?.[0]?.finish_reason,
      };
    }
  }

  async generate(ctx: ModelRunContext): Promise<ModelResponse> {
    await this.preflight();

    const toolDocs = ctx.tools.describe();
    const schema = actionJsonSchema(toolDocs.map((t) => t.name));
    const system = buildSystemPrompt(ctx, toolDocs);
    const messages: ChatMessage[] = [
      { role: "system", content: system },
      { role: "user", content: `Question: ${ctx.input.question}` },
    ];
    const seed = hashSeed(ctx.seed) % 2147483647;

    let inputTokens = 0;
    let outputTokens = 0;
    let usageMissing = false;

    for (let round = 0; round < this.cfg.maxRounds; round++) {
      const span = ctx.tracer.startSpan("model.call", { round, "json.mode": this.jsonMode });
      let result: ChatResult;
      try {
        result = await this.chat(messages, schema, seed);
        span.end();
      } catch (error) {
        span.end("error");
        throw error;
      }

      if (result.promptTokens !== undefined) inputTokens += result.promptTokens;
      else usageMissing = true;
      if (result.completionTokens !== undefined) outputTokens += result.completionTokens;
      else usageMissing = true;

      const action = parseAction(result.content);
      ctx.logger.log("model_turn", { round, action: action.kind, finish_reason: result.finishReason });

      if (action.kind === "invalid") {
        // A truncated reply needs different feedback than a malformed one:
        // asking the model to "follow the protocol" just reproduces the same
        // overflow; asking it to shorten actually converges.
        const feedback =
          result.finishReason === "length"
            ? "Your reply was cut off because it exceeded the generation limit. Send the SAME JSON action again but much shorter: keep the answer to one or two sentences and include at most two short claims."
            : `Your reply did not follow the protocol (${action.error}). Reply with exactly one JSON object as specified.`;
        messages.push({ role: "assistant", content: result.content }, { role: "user", content: feedback });
        continue;
      }

      if (action.kind === "tool") {
        let feedback: string;
        try {
          const toolResult = await ctx.tools.invokeAsync(action.tool, action.arguments);
          feedback = compactToolResult(toolResult);
          ctx.logger.log("tool_call", { tool: action.tool, ok: true });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          feedback = `ERROR: ${message}`;
          ctx.logger.log("tool_call", { tool: action.tool, ok: false, error: message });
        }
        messages.push(
          { role: "assistant", content: result.content },
          { role: "user", content: `TOOL_RESULT ${action.tool}: ${feedback}` },
        );
        continue;
      }

      // Final answer.
      const recorded: ToolCall[] = ctx.tools
        .recordedCalls()
        .map((c) => ({ tool: c.tool, arguments: c.arguments }));
      const output = coerceOutput(action.output, recorded);

      let usage: TokenUsage;
      if (inputTokens + outputTokens > 0) {
        usage = { inputTokens, outputTokens, estimated: usageMissing };
      } else {
        usage = estimateUsage(system, output);
      }
      ctx.logger.log("model_response", {
        status: (output as { status?: string }).status,
        rounds: round + 1,
        confidence: output.confidence,
      });
      return { output, usage };
    }

    throw new Error(
      `model did not produce a final answer within ${this.cfg.maxRounds} rounds (LLM_MAX_ROUNDS)`,
    );
  }
}
