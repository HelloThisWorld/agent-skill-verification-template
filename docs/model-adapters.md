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
| `openai-stub` | stub | Placeholder. Throws a clear error; no API call. |
| `anthropic-stub` | stub | Placeholder. Throws a clear error; no API call. |
| `ollama-stub` | stub | Placeholder. Throws a clear error; no API call. |

**The default demo uses `mock` and requires no API keys or network.**

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

## Adding a real adapter (roadmap)

1. Implement `ModelAdapter` (e.g. `src/models/anthropic-adapter.ts`).
2. Read the key from the environment (e.g. `ANTHROPIC_API_KEY`) — never hardcode.
3. Expose `repo_search` and `read_file` as tool definitions and run the tool-use
   loop, invoking `ctx.tools.invoke(...)` so calls are recorded.
4. Parse the final message into a `SkillOutput` and return real `usage`.
5. Register it in `createAdapter` (`src/models/model-adapter.ts`).

The stubs exist to mark exactly where this plugs in.
