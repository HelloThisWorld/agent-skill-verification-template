import type { ModelResponse, SkillOutput } from "../core/types.js";
import type { ModelAdapter, ModelRunContext } from "./model-adapter.js";
import { buildGroundedOutput, buildPrompt, estimateUsage, hashSeed, simulateLatency } from "./mock-adapter.js";

/**
 * Intentionally unstable adapter used to demonstrate failure detection, the
 * failure breakdown in the report, and replay artifacts.
 *
 * It first produces a valid grounded output (via the shared mock logic) and then
 * deterministically perturbs it based on the run seed, so failures are varied yet
 * fully reproducible. The failure modes map 1:1 onto the validators:
 *
 *   dropped_citations  -> citation + unsupported-claim failure
 *   wrong_line         -> citation "does not support claim" failure
 *   invalid_schema     -> schema failure
 *   wrong_tool_order   -> tool-call order failure
 *   unsupported_claim  -> hallucinated, uncited claim (forces an answer)
 */

export type FlakyFailureMode =
  | "none"
  | "dropped_citations"
  | "wrong_line"
  | "invalid_schema"
  | "wrong_tool_order"
  | "unsupported_claim";

export function applyFailureMode(
  good: SkillOutput,
  mode: number,
): { output: SkillOutput; failureMode: FlakyFailureMode } {
  const clone: SkillOutput = structuredClone(good);
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
      // Break the schema: an invalid status enum value.
      (clone as unknown as { status: string }).status = "maybe";
      return { output: clone, failureMode: "invalid_schema" };
    case 6:
      clone.toolCalls = [...clone.toolCalls].reverse();
      return { output: clone, failureMode: "wrong_tool_order" };
    case 7:
    default:
      clone.status = "answered";
      clone.claims = [
        ...clone.claims,
        { text: "It also deletes the user record after publishing.", citations: [] },
      ];
      return { output: clone, failureMode: "unsupported_claim" };
  }
}

export class MockFlakyAdapter implements ModelAdapter {
  readonly name = "mock-flaky";
  readonly type = "offline-deterministic-unstable";

  async generate(ctx: ModelRunContext): Promise<ModelResponse> {
    const good = buildGroundedOutput(ctx);
    const mode = hashSeed(`${ctx.seed}:mode`) % 8;
    const { output, failureMode } = applyFailureMode(good, mode);

    const usage = estimateUsage(buildPrompt(ctx), output);
    const spike = mode === 4 || mode === 7 ? 180 : 0;
    const simulatedLatencyMs = simulateLatency(ctx.seed, 55, 130) + spike;

    ctx.logger.log("model_response", {
      status: (output as { status: string }).status,
      failure_mode: failureMode,
      latency_ms: simulatedLatencyMs,
    });
    return { output, usage, simulatedLatencyMs };
  }
}
