import { readFileSync, statSync } from "node:fs";
import { extname } from "node:path";
import { parse as parseYaml } from "yaml";
import { z } from "zod";
import { InputError } from "./errors.js";
import { skillStatusSchema } from "./skill-contract.js";
import type { SkillInput, TestCase } from "./types.js";

/**
 * Evaluation-case loading for the CLI product.
 *
 * Cases may be authored as JSON (the repository's original format) or YAML.
 * Both formats share one schema: either a top-level array of cases or an
 * object with a `cases` array. User-provided case content (questions, names,
 * expected values) may be in any language and is preserved verbatim.
 */

export const testCaseSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  input: z.object({ question: z.string() }).passthrough(),
  kind: z.enum(["happy", "negative"]).optional(),
  expectedStatus: skillStatusSchema,
  requiredSymbols: z.array(z.string()).default([]),
  forbiddenClaims: z.array(z.string()).default([]),
  requiredTools: z.array(z.string()).default([]),
  expectedCitationFiles: z.array(z.string()).default([]),
  minPassRate: z.number().min(0).max(1).optional(),
});

const caseDocumentSchema = z.union([
  z.array(testCaseSchema),
  z.object({ cases: z.array(testCaseSchema) }),
]);

export function parseTestCases(
  raw: unknown,
  source: string,
  defaultKind: "happy" | "negative" = "happy",
): TestCase[] {
  const parsed = caseDocumentSchema.safeParse(raw);
  if (!parsed.success) {
    throw new InputError(`Invalid evaluation cases in ${source}:\n${parsed.error.toString()}`);
  }
  const list = Array.isArray(parsed.data) ? parsed.data : parsed.data.cases;
  if (list.length === 0) {
    throw new InputError(`No evaluation cases found in ${source}.`);
  }
  const seen = new Set<string>();
  for (const tc of list) {
    if (seen.has(tc.id)) {
      throw new InputError(`Duplicate case id "${tc.id}" in ${source}. Case ids must be unique.`);
    }
    seen.add(tc.id);
  }
  return list.map((tc) => ({
    id: tc.id,
    name: tc.name,
    input: { ...tc.input } as SkillInput,
    kind: tc.kind ?? defaultKind,
    expectedStatus: tc.expectedStatus,
    requiredSymbols: tc.requiredSymbols,
    forbiddenClaims: tc.forbiddenClaims,
    requiredTools: tc.requiredTools,
    expectedCitationFiles: tc.expectedCitationFiles,
    minPassRate: tc.minPassRate,
  }));
}

/** Parse a JSON or YAML document from disk based on the file extension. */
export function readStructuredFile(absPath: string, description: string): unknown {
  let stats;
  try {
    stats = statSync(absPath);
  } catch {
    throw new InputError(`${description} not found: ${absPath}`);
  }
  if (!stats.isFile()) {
    throw new InputError(`${description} is not a file: ${absPath}`);
  }
  const text = readFileSync(absPath, "utf8");
  const ext = extname(absPath).toLowerCase();
  try {
    if (ext === ".yaml" || ext === ".yml") return parseYaml(text);
    return JSON.parse(text);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new InputError(`Failed to parse ${description} at ${absPath}: ${message}`);
  }
}

/** Load evaluation cases from an explicit JSON or YAML file path. */
export function loadCasesFile(absPath: string): TestCase[] {
  const raw = readStructuredFile(absPath, "Evaluation cases file");
  return parseTestCases(raw, absPath);
}
