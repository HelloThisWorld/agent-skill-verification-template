import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";
import { readStructuredFile } from "../core/case-loader.js";
import { InputError } from "../core/errors.js";
import { repoRoot } from "../core/paths.js";
import { ALL_OUTPUT_FORMATS, type OutputFormat } from "../reporting/write-verification-outputs.js";

/**
 * Project configuration file: `skill-verification.yaml` (also .yml or .json).
 *
 * Precedence, highest first:
 *   1. explicit CLI flags
 *   2. the configuration file
 *   3. built-in defaults
 */

export const CONFIG_FILENAMES = [
  "skill-verification.yaml",
  "skill-verification.yml",
  "skill-verification.json",
];

const configSchema = z
  .object({
    schemaVersion: z.string().optional(),
    skill: z.object({ path: z.string().min(1) }).optional(),
    evaluation: z
      .object({
        cases: z.string().min(1).optional(),
        runs: z.number().int().positive().optional(),
        threshold: z.number().min(0).max(1).optional(),
        seed: z.number().int().optional(),
        timeoutMs: z.number().int().positive().optional(),
      })
      .optional(),
    adapter: z.object({ name: z.string().min(1).optional() }).optional(),
    output: z
      .object({
        directory: z.string().min(1).optional(),
        formats: z.array(z.enum(["json", "junit", "html", "replay"])).optional(),
      })
      .optional(),
    qualityGate: z
      .object({
        failOnThreshold: z.boolean().optional(),
        maximumFlakyRate: z.number().min(0).max(1).optional(),
      })
      .optional(),
  })
  .strict();

export interface ProjectConfig {
  skillPath?: string;
  casesPath?: string;
  runs?: number;
  threshold?: number;
  seed?: number;
  timeoutMs?: number;
  adapter?: string;
  outputDir?: string;
  formats?: OutputFormat[];
  failOnThreshold?: boolean;
  maximumFlakyRate?: number;
  /** Absolute path of the file the config was loaded from. */
  source?: string;
}

export function loadConfigFile(path: string): ProjectConfig {
  const abs = resolve(repoRoot(), path);
  const raw = readStructuredFile(abs, "Configuration file");
  const parsed = configSchema.safeParse(raw);
  if (!parsed.success) {
    throw new InputError(`Invalid configuration in ${abs}:\n${parsed.error.toString()}`);
  }
  const c = parsed.data;
  return {
    skillPath: c.skill?.path,
    casesPath: c.evaluation?.cases,
    runs: c.evaluation?.runs,
    threshold: c.evaluation?.threshold,
    seed: c.evaluation?.seed,
    timeoutMs: c.evaluation?.timeoutMs,
    adapter: c.adapter?.name,
    outputDir: c.output?.directory,
    formats: c.output?.formats ?? undefined,
    failOnThreshold: c.qualityGate?.failOnThreshold,
    maximumFlakyRate: c.qualityGate?.maximumFlakyRate,
    source: abs,
  };
}

/**
 * Load configuration: an explicit `--config` path is required to exist; when
 * omitted, the default file names are probed in the workspace root and an
 * empty config is returned if none is present.
 */
export function loadProjectConfig(explicitPath?: string): ProjectConfig {
  if (explicitPath) return loadConfigFile(explicitPath);
  for (const name of CONFIG_FILENAMES) {
    const candidate = resolve(repoRoot(), name);
    if (existsSync(candidate)) return loadConfigFile(candidate);
  }
  return {};
}

export { ALL_OUTPUT_FORMATS };
