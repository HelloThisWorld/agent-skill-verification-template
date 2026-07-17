import { InputError } from "../../core/errors.js";
import type { CanonicalResult } from "../../core/canonical-result.js";
import { verifySkill } from "../../core/verification-service.js";
import { ALL_OUTPUT_FORMATS, type OutputFormat } from "../../reporting/write-verification-outputs.js";
import { loadProjectConfig } from "../config-file.js";
import { bold, colorEnabled, green, red, type CliIo } from "../io.js";

/**
 * `agent-skill-verifier verify` — run the evaluation suite against a skill and
 * write the report bundle. Exit codes: 0 gate passed, 1 gate failed (when
 * --fail-on-threshold, the default), 2-6 per the documented error contract.
 */

export interface VerifyCliOptions {
  skill?: string;
  cases?: string;
  config?: string;
  adapter?: string;
  runs?: string;
  threshold?: string;
  seed?: string;
  timeoutMs?: string;
  output?: string;
  format?: string;
  json?: boolean;
  failOnThreshold?: boolean;
  nonInteractive?: boolean;
  verbose?: boolean;
  quiet?: boolean;
}

interface ResolvedVerifyOptions {
  skillPath: string;
  casesPath: string;
  adapter: string;
  runs: number;
  threshold: number;
  seed?: number;
  timeoutMs?: number;
  outputDir: string;
  formats: OutputFormat[];
  failOnThreshold: boolean;
  maximumFlakyRate?: number;
  json: boolean;
  verbose: boolean;
  quiet: boolean;
}

export function parsePositiveInt(value: string, flag: string): number {
  if (!/^\d+$/.test(value.trim())) {
    throw new InputError(`${flag} must be a positive integer (got "${value}").`);
  }
  const parsed = Number.parseInt(value, 10);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new InputError(`${flag} must be a positive integer (got "${value}").`);
  }
  return parsed;
}

export function parseThreshold(value: string, flag: string): number {
  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1 || value.trim() === "") {
    throw new InputError(`${flag} must be a number between 0 and 1 (got "${value}").`);
  }
  return parsed;
}

export function parseSeed(value: string, flag: string): number {
  if (!/^-?\d+$/.test(value.trim())) {
    throw new InputError(`${flag} must be an integer (got "${value}").`);
  }
  const parsed = Number.parseInt(value, 10);
  if (!Number.isSafeInteger(parsed)) {
    throw new InputError(`${flag} must be a safe integer (got "${value}").`);
  }
  return parsed;
}

export function resolveVerifyOptions(opts: VerifyCliOptions): ResolvedVerifyOptions {
  if (opts.quiet && opts.verbose) {
    throw new InputError("--quiet and --verbose are mutually exclusive.");
  }
  if (opts.json && opts.format === "terminal") {
    throw new InputError("--json conflicts with --format terminal.");
  }
  if (opts.format !== undefined && opts.format !== "terminal" && opts.format !== "json") {
    throw new InputError(`--format must be "terminal" or "json" (got "${opts.format}").`);
  }

  const config = loadProjectConfig(opts.config);

  const skillPath = opts.skill ?? config.skillPath;
  if (!skillPath) {
    throw new InputError(
      "No skill specified. Pass --skill <path> or set skill.path in skill-verification.yaml.",
    );
  }
  const casesPath = opts.cases ?? config.casesPath;
  if (!casesPath) {
    throw new InputError(
      "No evaluation cases specified. Pass --cases <path> or set evaluation.cases in skill-verification.yaml.",
    );
  }

  const runs = opts.runs !== undefined ? parsePositiveInt(opts.runs, "--runs") : (config.runs ?? 10);
  const threshold =
    opts.threshold !== undefined
      ? parseThreshold(opts.threshold, "--threshold")
      : (config.threshold ?? 0.9);
  const seed = opts.seed !== undefined ? parseSeed(opts.seed, "--seed") : config.seed;
  const timeoutMs =
    opts.timeoutMs !== undefined
      ? parsePositiveInt(opts.timeoutMs, "--timeout-ms")
      : config.timeoutMs;

  return {
    skillPath,
    casesPath,
    adapter: opts.adapter ?? config.adapter ?? "mock",
    runs,
    threshold,
    seed,
    timeoutMs,
    outputDir: opts.output ?? config.outputDir ?? ".agent-skill-verification",
    formats: config.formats ?? ALL_OUTPUT_FORMATS,
    failOnThreshold: opts.failOnThreshold ?? config.failOnThreshold ?? true,
    maximumFlakyRate: config.maximumFlakyRate,
    json: Boolean(opts.json) || opts.format === "json",
    verbose: Boolean(opts.verbose),
    quiet: Boolean(opts.quiet),
  };
}

function pct(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function printTerminalSummary(
  io: CliIo,
  canonical: CanonicalResult,
  outputDirAbs: string,
  quiet: boolean,
): void {
  const color = colorEnabled({ json: false });
  const resultText =
    canonical.summary.result === "passed" ? green(color, "PASSED") : red(color, "FAILED");

  if (quiet) {
    io.out(`${canonical.skill.name}: ${canonical.summary.result.toUpperCase()} (${pct(canonical.summary.passRate)})`);
    return;
  }

  const row = (label: string, value: string): string => `  ${label.padEnd(22)}${value}`;
  const lines = [
    "",
    bold(color, "================ Verification Summary ================"),
    row("Skill:", `${canonical.skill.name} v${canonical.skill.version}`),
    row("Adapter:", canonical.configuration.adapter),
    row("Cases:", String(canonical.summary.cases)),
    row("Runs per case:", String(canonical.configuration.runsPerCase)),
    row("Total runs:", String(canonical.summary.totalRuns)),
    row("Pass rate:", `${pct(canonical.summary.passRate)} (threshold ${pct(canonical.configuration.threshold)})`),
    row("Flaky cases:", String(canonical.summary.flakyCases)),
    row("Result:", resultText),
    row("Output:", outputDirAbs),
  ];
  if (!canonical.gate.passed && canonical.gate.reasons.length > 0) {
    lines.push(row("Gate:", canonical.gate.reasons.join("; ")));
  }
  lines.push(bold(color, "======================================================="), "");
  io.out(lines.join("\n"));
}

export async function runVerifyCommand(io: CliIo, opts: VerifyCliOptions): Promise<number> {
  const resolved = resolveVerifyOptions(opts);

  if (resolved.verbose && !resolved.json) {
    io.err(
      `verify: skill=${resolved.skillPath} cases=${resolved.casesPath} adapter=${resolved.adapter} ` +
        `runs=${resolved.runs} threshold=${resolved.threshold} output=${resolved.outputDir}` +
        (resolved.seed !== undefined ? ` seed=${resolved.seed}` : ""),
    );
  }

  const result = await verifySkill({
    skillPath: resolved.skillPath,
    casesPath: resolved.casesPath,
    adapter: resolved.adapter,
    runsPerCase: resolved.runs,
    threshold: resolved.threshold,
    seed: resolved.seed,
    timeoutMs: resolved.timeoutMs,
    outputDir: resolved.outputDir,
    formats: resolved.formats,
    maximumFlakyRate: resolved.maximumFlakyRate,
  });

  if (resolved.json) {
    // JSON mode always prints the full normalized result, pass or fail.
    io.out(JSON.stringify(result.outputs.canonical, null, 2));
  } else {
    printTerminalSummary(io, result.outputs.canonical, result.outputs.outputDirAbs, resolved.quiet);
  }

  if (!result.gatePassed && resolved.failOnThreshold) return 1;
  return 0;
}
