import type { ModelResponse } from "../core/types.js";
import type { ModelAdapter, ModelRunContext } from "./model-adapter.js";

/**
 * STUB adapter. Does NOT call the OpenAI API.
 *
 * It exists to show where a real adapter would plug in and to keep the CLI's
 * model list honest. A real implementation would read `OPENAI_API_KEY`, translate
 * the skill contract + tools into a tool-use request, and map the response back to
 * a `SkillOutput`. That is a roadmap item (see docs/model-adapters.md).
 */
export class OpenAiStubAdapter implements ModelAdapter {
  readonly name = "openai-stub";
  readonly type = "stub";

  async generate(_ctx: ModelRunContext): Promise<ModelResponse> {
    throw new Error(
      "openai-stub is a placeholder and does not call any API. " +
        "A real OpenAI adapter is a roadmap item (see docs/model-adapters.md). " +
        "The default offline demo uses --model mock.",
    );
  }
}
