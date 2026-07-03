# Model Adapters

An adapter is the only place that knows *how a model is called*. The harness treats
every adapter identically, which is what lets you compare reliability profiles
across models. Interface: `src/models/model-adapter.ts`.

```ts
interface ModelAdapter {
  readonly name: string;
  readonly type: string;
  generate(ctx: ModelRunContext): Promise<ModelResponse>;
}
```

Adapters receive the question, the contract, the tools, and telemetry handles —
but **not** the test case's expected answer, required symbols, or forbidden
claims. This keeps the eval honest: a model cannot peek at the grading key.

## Included adapters

| Name | Type | Notes |
| --- | --- | --- |
| `mock` | offline-deterministic | Reference implementation. Genuinely source-grounded via `repo_search`/`read_file`; deterministic; satisfies the contract. |
| `mock-flaky` | offline-deterministic-unstable | Produces a valid output then deterministically perturbs it to exercise every failure path. |
| `glossary` / `glossary-flaky` | offline-deterministic(-unstable) | Reference + flaky adapters for the `glossary` skill (`wikipedia_search` → `wikipedia_fetch`). |
| `openmind` / `openmind-flaky` | openmind-python-bridge(-unstable) | Drives Open Mind's real Python implementation through the skill bridge; no language model involved. |
| `llm` | openai-compatible-live | **A real language model.** Speaks the OpenAI-compatible chat API: local llama.cpp `llama-server`, local Ollama, or any remote provider. See below. |
| `openai-stub` | stub | Placeholder. Throws a clear error; no API call. |
| `anthropic-stub` | stub | Placeholder. Throws a clear error; no API call. |
| `ollama-stub` | stub | Placeholder. Throws a clear error; no API call. |

**The default demo uses `mock` and requires no API keys or network.**

## Live adapter (`llm`)

`src/models/llm-adapter.ts` is the first adapter where a real model produces the
output. It is fully configurable through the environment (CLI flags override):

| Env var | Default | Meaning |
| --- | --- | --- |
| `LLM_BASE_URL` | `http://127.0.0.1:8080/v1` | OpenAI-compatible base URL (llama.cpp, Ollama, or remote). |
| `LLM_MODEL` | *(empty)* | Model name/tag. Optional for llama.cpp; required for Ollama/remote APIs. |
| `LLM_API_KEY` | *(empty)* | Bearer token for remote APIs. |
| `LLM_JSON_MODE` | `schema` | `schema` (grammar-constrained on llama.cpp) \| `object` \| `off`. Auto-downgrades on HTTP 400. |
| `LLM_MAX_ROUNDS` | `8` | Max model turns per run (tool calls + final answer). |
| `LLM_MAX_TOKENS` | `2048` | Generation cap per turn (truncated turns get "shorten your reply" feedback). |
| `LLM_TIMEOUT_MS` | `180000` | Hard per-request timeout (AbortController). |
| `LLM_TEMPERATURE` | `0` | Sampling temperature. |

How it works:

1. The system prompt is the skill contract rendered as instructions plus the
   tool docs from the live registry (`ToolRegistry.describe()`), and the action
   protocol. Grading-key fields are never included.
2. Each model turn must be one JSON action: `{"action":"tool",...}` (executed via
   `ctx.tools.invokeAsync`, so the recording registry captures the ground truth)
   or `{"action":"final","output":<SkillOutput>}`.
3. In `schema` mode, llama.cpp enforces the action shape with grammar-constrained
   decoding, which makes malformed-JSON failures rare even for small quantized
   models.
4. `toolCalls` in the final output is always replaced by the registry's recorded
   trace; usage is server-reported (`estimated: false`) and latency is measured
   wall-clock.

Resource safety: requests are sequential, every call has a hard timeout, the
tool loop and generation length are capped, and `scripts/start-eval-llm.ps1`
starts a single local server with a small context window (8K), `--parallel 1`,
bound to `127.0.0.1`, with free-RAM checks before loading the model.

## Mock adapter (how grounding works)

`src/models/mock-adapter.ts`:

1. Extract "strong" terms (CamelCase identifiers) and "weak" terms (keywords) from
   the question.
2. `repo_search` each term; accumulate per-file evidence.
3. A file is answerable if it has ≥1 strong hit or ≥2 distinct weak hits.
4. Pick the best file, `read_file` it, cite the most evidence-dense line.
5. If nothing is answerable, return `insufficient_evidence` (no fabrication).

## Flaky adapter (failure modes)

`src/models/mock-flaky-adapter.ts` chooses a mode deterministically from the run
seed, so failures are varied yet reproducible:

| Mode | Effect | Caught by |
| --- | --- | --- |
| `dropped_citations` | remove citations | citation + unsupported_claim |
| `wrong_line` | shift the cited line | citation (does not support) |
| `invalid_schema` | invalid `status` enum | schema |
| `wrong_tool_order` | `read_file` before `repo_search` | tool_call |
| `unsupported_claim` | add uncited, hallucinated claim | unsupported_claim |

## Estimated values (labeled)

For the mock adapters, tokens (~4 chars/token), latency (deterministic from the
seed), and cost (demo pricing in `src/core/thresholds.ts`) are **estimated/demo**
values. They are labeled as such everywhere they appear.

## Adding another real adapter

The OpenAI-compatible live adapter (`llm`, above) already covers llama.cpp,
Ollama, and OpenAI-compatible remote APIs. For a provider-native adapter (e.g.
the Anthropic Messages API with native tool use):

1. Implement `ModelAdapter` (e.g. `src/models/anthropic-adapter.ts`).
2. Read the key from the environment (e.g. `ANTHROPIC_API_KEY`) — never hardcode.
3. Expose the registry's tools (`ctx.tools.describe()`) as tool definitions and
   run the tool-use loop, invoking `ctx.tools.invokeAsync(...)` so calls are recorded.
4. Parse the final message into a `SkillOutput` and return real `usage`.
5. Register it in `createAdapter` (`src/models/model-adapter.ts`).

The remaining stubs mark exactly where this plugs in; `llm-adapter.ts` is the
working example to copy from.
