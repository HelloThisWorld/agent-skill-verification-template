import { z } from "zod";
import type { ValidatorResult } from "../core/types.js";
import type { ValidatorInput } from "./validation-summary.js";
import { VALIDATOR_NAMES } from "./validation-summary.js";

/**
 * Schema validator — checks that the model output has the exact required shape.
 * This is the first line of defense: nothing downstream can trust a malformed
 * object. The zod schema mirrors the `SkillOutput` type in core/types.ts.
 */

const citationSchema = z.object({
  file: z.string().min(1),
  line: z.number().int().positive(),
});

const claimSchema = z.object({
  text: z.string().min(1),
  citations: z.array(citationSchema),
});

const toolCallSchema = z.object({
  tool: z.string().min(1),
  arguments: z.record(z.unknown()),
});

export const skillOutputSchema = z.object({
  status: z.enum(["answered", "insufficient_evidence", "refused"]),
  answer: z.string(),
  claims: z.array(claimSchema),
  toolCalls: z.array(toolCallSchema),
  confidence: z.enum(["low", "medium", "high"]).optional(),
});

export function validateSchema(input: ValidatorInput): ValidatorResult {
  const result = skillOutputSchema.safeParse(input.output);
  if (result.success) {
    return { validator: VALIDATOR_NAMES.schema, passed: true, reasons: [], details: {} };
  }
  const issues = result.error.issues.map(
    (i) => `${i.path.join(".") || "(root)"}: ${i.message}`,
  );
  return {
    validator: VALIDATOR_NAMES.schema,
    passed: false,
    reasons: issues,
    details: { issues },
  };
}
