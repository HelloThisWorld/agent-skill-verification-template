import { describe, expect, it } from "vitest";
import {
  actionJsonSchema,
  buildSystemPrompt,
  coerceOutput,
  compactToolResult,
  extractJson,
  parseAction,
  resolveLlmConfig,
} from "../src/models/llm-adapter.js";
import { loadSkillContract } from "../src/core/skill-contract.js";
import type { ModelRunContext } from "../src/models/model-adapter.js";

describe("resolveLlmConfig", () => {
  it("applies defaults when the environment is empty", () => {
    const cfg = resolveLlmConfig({});
    expect(cfg.baseUrl).toBe("http://127.0.0.1:8080/v1");
    expect(cfg.model).toBe("");
    expect(cfg.temperature).toBe(0);
    expect(cfg.maxRounds).toBe(8);
    expect(cfg.jsonMode).toBe("schema");
  });

  it("reads overrides from the environment and strips trailing slashes", () => {
    const cfg = resolveLlmConfig({
      LLM_BASE_URL: "http://127.0.0.1:11434/v1/",
      LLM_MODEL: "gemma",
      LLM_MAX_ROUNDS: "3",
      LLM_TIMEOUT_MS: "5000",
      LLM_JSON_MODE: "object",
    });
    expect(cfg.baseUrl).toBe("http://127.0.0.1:11434/v1");
    expect(cfg.model).toBe("gemma");
    expect(cfg.maxRounds).toBe(3);
    expect(cfg.timeoutMs).toBe(5000);
    expect(cfg.jsonMode).toBe("object");
  });

  it("rejects invalid values", () => {
    expect(() => resolveLlmConfig({ LLM_JSON_MODE: "grammar" })).toThrow(/LLM_JSON_MODE/);
    expect(() => resolveLlmConfig({ LLM_TIMEOUT_MS: "-1" })).toThrow(/LLM_TIMEOUT_MS/);
  });
});

describe("extractJson", () => {
  it("extracts a bare JSON object", () => {
    expect(extractJson('{"a":1}')).toBe('{"a":1}');
  });

  it("extracts from a markdown fence with surrounding prose", () => {
    const text = 'Sure! Here you go:\n```json\n{"action":"final","output":{}}\n```\nDone.';
    expect(extractJson(text)).toBe('{"action":"final","output":{}}');
  });

  it("handles nested braces and braces inside strings", () => {
    const text = 'prefix {"a":{"b":"}{"},"c":[1,2]} suffix {"ignored":true}';
    expect(extractJson(text)).toBe('{"a":{"b":"}{"},"c":[1,2]}');
  });

  it("returns null when there is no JSON object", () => {
    expect(extractJson("no json here")).toBeNull();
    expect(extractJson('{"unterminated": tr')).toBeNull();
  });
});

describe("parseAction", () => {
  it("parses a tool action", () => {
    const a = parseAction('{"action":"tool","tool":"wikipedia_search","arguments":{"query":"Mexico"}}');
    expect(a).toEqual({ kind: "tool", tool: "wikipedia_search", arguments: { query: "Mexico" } });
  });

  it("defaults missing tool arguments to an empty object", () => {
    const a = parseAction('{"action":"tool","tool":"wikipedia_search"}');
    expect(a).toEqual({ kind: "tool", tool: "wikipedia_search", arguments: {} });
  });

  it("parses a final action", () => {
    const a = parseAction('{"action":"final","output":{"status":"answered","answer":"x","claims":[]}}');
    expect(a.kind).toBe("final");
    if (a.kind === "final") expect(a.output.status).toBe("answered");
  });

  it("flags protocol violations without throwing", () => {
    expect(parseAction("plain text").kind).toBe("invalid");
    expect(parseAction('{"action":"dance"}').kind).toBe("invalid");
    expect(parseAction('{"action":"tool"}').kind).toBe("invalid"); // missing tool name
  });
});

describe("compactToolResult", () => {
  it("passes small results through unchanged", () => {
    expect(compactToolResult({ found: true, line: 12 })).toBe('{"found":true,"line":12}');
  });

  it("truncates long strings and long arrays but keeps structure", () => {
    const result = {
      ledeLine: 42,
      extract: "x".repeat(2000),
      matches: Array.from({ length: 50 }, (_, i) => i),
    };
    const json = compactToolResult(result);
    expect(json).toContain('"ledeLine":42');
    expect(json).toContain("[truncated]");
    expect(json).toContain("30 more items truncated");
    expect(json.length).toBeLessThanOrEqual(6100);
  });
});

describe("coerceOutput", () => {
  const recorded = [{ tool: "wikipedia_search", arguments: { query: "Mexico" } }];

  it("always uses the recorded tool calls as the trace", () => {
    const out = coerceOutput(
      { status: "answered", answer: "a", claims: [], toolCalls: [{ tool: "fake", arguments: {} }] },
      recorded,
    );
    expect(out.toolCalls).toEqual(recorded);
  });

  it("guarantees iterable claim/citation containers without repairing values", () => {
    const out = coerceOutput({ status: "maybe", answer: 7, claims: "nope" }, recorded);
    expect(out.claims).toEqual([]);
    // Wrong status and non-string answer are preserved for the schema validator to fail.
    expect((out as unknown as { status: string }).status).toBe("maybe");
    expect((out as unknown as { answer: number }).answer).toBe(7);
  });

  it("normalizes claim text and citations to safe shapes", () => {
    const out = coerceOutput(
      { status: "answered", answer: "a", claims: [{ citations: "x" }, { text: "ok", citations: [{ file: "f", line: 1 }] }] },
      recorded,
    );
    expect(out.claims[0]).toMatchObject({ text: "", citations: [] });
    expect(out.claims[1]).toMatchObject({ text: "ok", citations: [{ file: "f", line: 1 }] });
  });
});

describe("buildSystemPrompt", () => {
  it("renders the contract and tool docs, and never mentions grading fields", () => {
    const contract = loadSkillContract("glossary");
    const ctx = { skill: contract, input: { question: "glossary Mexico" } } as ModelRunContext;
    const prompt = buildSystemPrompt(ctx, [
      { name: "wikipedia_search", description: "search snapshots", parameters: { query: "term" } },
      { name: "wikipedia_fetch", description: "read a snapshot", parameters: {} },
    ]);
    expect(prompt).toContain('skill "glossary"');
    expect(prompt).toContain("wikipedia_search");
    expect(prompt).toContain('"query": term');
    expect(prompt).toContain('"action":"final"');
    // The tool contract (required tools + order) must be stated explicitly.
    expect(prompt).toContain("MUST call wikipedia_search and wikipedia_fetch");
    expect(prompt).toContain("wikipedia_search before wikipedia_fetch");
    // The grading key must never leak into the prompt.
    expect(prompt).not.toMatch(/requiredSymbols|forbiddenClaims|expectedStatus|expectedCitationFiles/);
  });
});

describe("actionJsonSchema", () => {
  it("constrains tool names and the final output shape", () => {
    const schema = actionJsonSchema(["wikipedia_search"]) as {
      oneOf: { properties: Record<string, unknown> }[];
    };
    expect(schema.oneOf).toHaveLength(2);
    const toolBranch = schema.oneOf[0].properties.tool as { enum: string[] };
    expect(toolBranch.enum).toEqual(["wikipedia_search"]);
    const outputBranch = schema.oneOf[1].properties.output as { required: string[] };
    expect(outputBranch.required).toEqual(["status", "answer", "claims"]);
  });
});
