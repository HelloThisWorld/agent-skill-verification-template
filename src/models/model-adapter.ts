import type { ModelResponse, RunVersions, SkillInput } from "../core/types.js";
import type { SkillContract } from "../core/skill-contract.js";
import type { ToolRegistry } from "../tools/tool-registry.js";
import type { Tracer } from "../telemetry/tracing.js";
import type { StructuredLogger } from "../telemetry/logger.js";

/**
 * Model adapter abstraction.
 *
 * An adapter is the ONLY place that knows how a model is called. The eval harness
 * treats every adapter identically, which is what makes it possible to compare
 * reliability profiles (pass rate, latency, cost, failure patterns) across models.
 *
 * Adapters intentionally do NOT receive the test case's expected answer, required
 * symbols, or forbidden claims — they only see the question, the contract, and the
 * tools. This keeps the eval honest: the model cannot "peek" at the grading key.
 */
export interface ModelRunContext {
  runId: string;
  traceId: string;
  skill: SkillContract;
  /** Normalized input (see input.normalization in the eval runner). */
  input: SkillInput;
  tools: ToolRegistry;
  tracer: Tracer;
  logger: StructuredLogger;
  versions: RunVersions;
  modelName: string;
  /** Deterministic seed derived from test-case id + attempt index. */
  seed: string;
}

export interface ModelAdapter {
  readonly name: string;
  readonly type: string;
  generate(ctx: ModelRunContext): Promise<ModelResponse>;
}

/** Model names understood by the CLI. */
export const SUPPORTED_MODELS = [
  "mock",
  "mock-flaky",
  "openai-stub",
  "anthropic-stub",
  "ollama-stub",
] as const;

export type SupportedModel = (typeof SUPPORTED_MODELS)[number];

/**
 * Adapter factory. Imports are done lazily-per-branch to keep the dependency
 * graph obvious; all adapters are cheap to construct.
 */
export async function createAdapter(name: string): Promise<ModelAdapter> {
  switch (name) {
    case "mock": {
      const { MockAdapter } = await import("./mock-adapter.js");
      return new MockAdapter();
    }
    case "mock-flaky": {
      const { MockFlakyAdapter } = await import("./mock-flaky-adapter.js");
      return new MockFlakyAdapter();
    }
    case "openai-stub": {
      const { OpenAiStubAdapter } = await import("./openai-adapter.stub.js");
      return new OpenAiStubAdapter();
    }
    case "anthropic-stub": {
      const { AnthropicStubAdapter } = await import("./anthropic-adapter.stub.js");
      return new AnthropicStubAdapter();
    }
    case "ollama-stub": {
      const { OllamaStubAdapter } = await import("./ollama-adapter.stub.js");
      return new OllamaStubAdapter();
    }
    default:
      throw new Error(
        `Unknown model "${name}". Supported: ${SUPPORTED_MODELS.join(", ")}.`,
      );
  }
}
