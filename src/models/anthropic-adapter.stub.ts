import type { ModelResponse } from "../core/types.js";
import type { ModelAdapter, ModelRunContext } from "./model-adapter.js";

/**
 * STUB adapter. Does NOT call the Anthropic API.
 *
 * A real implementation would read `ANTHROPIC_API_KEY`, expose `repo_search` and
 * `read_file` as tool definitions, run the tool-use loop, and parse the final
 * message into a `SkillOutput`. That is a roadmap item (see docs/model-adapters.md).
 */
export class AnthropicStubAdapter implements ModelAdapter {
  readonly name = "anthropic-stub";
  readonly type = "stub";

  async generate(_ctx: ModelRunContext): Promise<ModelResponse> {
    throw new Error(
      "anthropic-stub is a placeholder and does not call any API. " +
        "A real Anthropic adapter is a roadmap item (see docs/model-adapters.md). " +
        "The default offline demo uses --model mock.",
    );
  }
}
