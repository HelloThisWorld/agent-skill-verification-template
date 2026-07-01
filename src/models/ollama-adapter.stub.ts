import type { ModelResponse } from "../core/types.js";
import type { ModelAdapter, ModelRunContext } from "./model-adapter.js";

/**
 * STUB adapter. Does NOT call a local Ollama server.
 *
 * A real implementation would POST to an Ollama-compatible `/api/chat` endpoint
 * (default `http://localhost:11434`), drive tool calls, and parse the response
 * into a `SkillOutput`. Because it targets a local server it could run fully
 * offline once implemented. That is a roadmap item (see docs/model-adapters.md).
 */
export class OllamaStubAdapter implements ModelAdapter {
  readonly name = "ollama-stub";
  readonly type = "stub";

  async generate(_ctx: ModelRunContext): Promise<ModelResponse> {
    throw new Error(
      "ollama-stub is a placeholder and does not call any endpoint. " +
        "A real Ollama-compatible adapter is a roadmap item (see docs/model-adapters.md). " +
        "The default offline demo uses --model mock.",
    );
  }
}
