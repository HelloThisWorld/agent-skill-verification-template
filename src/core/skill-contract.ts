import { readFileSync } from "node:fs";
import { z } from "zod";
import { resolveFromRoot } from "./paths.js";

/**
 * The skill contract defines WHAT a skill must do, independent of any model.
 *
 * It is loaded from `skills/<name>/skill-contract.json` and validated with zod on
 * load so a malformed contract fails fast with a clear error. Reliability of a
 * given model against this contract is measured separately by the eval harness.
 */

export const skillStatusSchema = z.enum(["answered", "insufficient_evidence", "refused"]);

const toolContractEntrySchema = z.object({
  name: z.string(),
  description: z.string(),
  required: z.boolean(),
});

export const skillContractSchema = z.object({
  name: z.string(),
  version: z.string(),
  description: z.string(),
  input: z.object({
    description: z.string(),
    fields: z.array(
      z.object({
        name: z.string(),
        type: z.string(),
        required: z.boolean(),
        description: z.string(),
      }),
    ),
  }),
  output: z.object({
    description: z.string(),
    statusValues: z.array(skillStatusSchema),
    requires: z.array(z.string()),
  }),
  tools: z.array(toolContractEntrySchema),
  /** Tools that, when both present, must appear in this relative order. */
  toolOrder: z.array(z.string()),
  citationRequirement: z.string(),
  unsupportedClaimPolicy: z.string(),
  failureBehavior: z.string(),
  validationRules: z.array(z.string()),
  promptVersion: z.string(),
  toolSchemaVersion: z.string(),
  /** Repo-relative root of the codebase the skill answers questions about. */
  fixtureRoot: z.string(),
});

export type SkillContract = z.infer<typeof skillContractSchema>;

/** Load and validate the contract for a named skill. */
export function loadSkillContract(skillName: string): SkillContract {
  const path = resolveFromRoot(`skills/${skillName}/skill-contract.json`);
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to read skill contract at ${path}: ${message}`);
  }
  const parsed = skillContractSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(`Invalid skill contract at ${path}:\n${parsed.error.toString()}`);
  }
  return parsed.data;
}

/** Names of the tools the contract marks as required. */
export function requiredToolNames(contract: SkillContract): string[] {
  return contract.tools.filter((t) => t.required).map((t) => t.name);
}
