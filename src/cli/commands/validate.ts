import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { loadCasesFile } from "../../core/case-loader.js";
import { InputError, errorMessage } from "../../core/errors.js";
import { repoRoot } from "../../core/paths.js";
import {
  loadSkillContractFromDir,
  requiredToolNames,
  SKILL_CONTRACT_FILENAME,
} from "../../core/skill-contract.js";
import { isKnownAdapter } from "../../core/verification-service.js";
import { createToolRegistry } from "../../tools/tool-registry.js";
import { resolveOutputDir } from "../../reporting/write-verification-outputs.js";
import { loadProjectConfig } from "../config-file.js";
import { colorEnabled, green, red, yellow, type CliIo } from "../io.js";
import { parsePositiveInt, parseThreshold } from "./verify.js";

/**
 * `agent-skill-verifier validate` — static validation of a skill directory,
 * its evaluation cases, and the effective configuration. Never executes an
 * evaluation run. Exit 0 when valid, 2 when any check fails.
 */

export interface ValidateCliOptions {
  skill?: string;
  cases?: string;
  config?: string;
  adapter?: string;
  runs?: string;
  threshold?: string;
  output?: string;
  json?: boolean;
  quiet?: boolean;
}

export interface ValidationFinding {
  level: "error" | "warning";
  check: string;
  message: string;
}

export interface ValidationReport {
  valid: boolean;
  skillPath: string | null;
  casesPath: string | null;
  checksRun: number;
  findings: ValidationFinding[];
}

export function validateInputs(opts: ValidateCliOptions): ValidationReport {
  const findings: ValidationFinding[] = [];
  let checksRun = 0;
  const error = (check: string, message: string): void => {
    findings.push({ level: "error", check, message });
  };
  const warning = (check: string, message: string): void => {
    findings.push({ level: "warning", check, message });
  };

  const config = loadProjectConfig(opts.config);
  const skillPath = opts.skill ?? config.skillPath ?? null;
  const casesPath = opts.cases ?? config.casesPath ?? null;
  const root = repoRoot();

  // 1. Skill directory and contract.
  checksRun++;
  let contract = null;
  if (!skillPath) {
    error("skill-path", "No skill specified (--skill or skill.path in configuration).");
  } else {
    try {
      contract = loadSkillContractFromDir(resolve(root, skillPath));
    } catch (e) {
      error("skill-contract", errorMessage(e));
    }
  }

  // 2. Contract-level checks.
  if (contract) {
    checksRun++;
    const fixtureAbs = resolve(root, contract.fixtureRoot);
    if (!existsSync(fixtureAbs)) {
      error(
        "fixture-root",
        `Contract fixtureRoot "${contract.fixtureRoot}" does not exist (resolved to ${fixtureAbs}).`,
      );
    }

    checksRun++;
    const registry = createToolRegistry(contract.name, contract.fixtureRoot);
    for (const tool of requiredToolNames(contract)) {
      if (!registry.has(tool)) {
        error(
          "required-tools",
          `Contract requires tool "${tool}" but no such tool is registered for skill "${contract.name}".`,
        );
      }
    }
  }

  // 3. Evaluation cases.
  let cases = null;
  checksRun++;
  if (!casesPath) {
    error("cases-path", "No evaluation cases specified (--cases or evaluation.cases in configuration).");
  } else {
    try {
      cases = loadCasesFile(resolve(root, casesPath));
    } catch (e) {
      error("cases-schema", errorMessage(e));
    }
  }

  if (cases && contract) {
    checksRun++;
    for (const tc of cases) {
      if (!contract.output.statusValues.includes(tc.expectedStatus)) {
        error(
          "expected-status",
          `Case "${tc.id}" expects status "${tc.expectedStatus}" which the contract does not declare.`,
        );
      }
      for (const file of tc.expectedCitationFiles) {
        if (!existsSync(resolve(root, file))) {
          error(
            "expected-citations",
            `Case "${tc.id}" expects citations from "${file}" which does not exist.`,
          );
        }
      }
    }
  }

  // 4. Adapter.
  checksRun++;
  const adapter = opts.adapter ?? config.adapter ?? "mock";
  if (!isKnownAdapter(adapter)) {
    error("adapter", `Unknown adapter "${adapter}".`);
  }

  // 5. Numeric configuration.
  checksRun++;
  try {
    if (opts.runs !== undefined) parsePositiveInt(opts.runs, "--runs");
  } catch (e) {
    error("runs", errorMessage(e));
  }
  try {
    if (opts.threshold !== undefined) parseThreshold(opts.threshold, "--threshold");
  } catch (e) {
    error("threshold", errorMessage(e));
  }

  // 6. Output directory boundary.
  checksRun++;
  const outputDir = opts.output ?? config.outputDir ?? ".agent-skill-verification";
  try {
    resolveOutputDir(outputDir);
  } catch (e) {
    error("output-path", errorMessage(e));
  }

  // 7. Advisory checks.
  if (contract && skillPath) {
    checksRun++;
    const contractFile = join(resolve(root, skillPath), SKILL_CONTRACT_FILENAME);
    if (contract.name && !existsSync(contractFile)) {
      // unreachable in practice (contract loaded above); kept as a guard
      warning("skill-structure", `Contract file missing at ${contractFile}.`);
    }
    if (cases && cases.every((c) => c.kind !== "negative")) {
      warning(
        "case-coverage",
        "No negative cases found; consider adding cases that verify refusal/insufficient-evidence behavior.",
      );
    }
  }

  return {
    valid: !findings.some((f) => f.level === "error"),
    skillPath,
    casesPath,
    checksRun,
    findings,
  };
}

export function runValidateCommand(io: CliIo, opts: ValidateCliOptions): number {
  let report: ValidationReport;
  try {
    report = validateInputs(opts);
  } catch (e) {
    // Configuration file itself failed to load/parse.
    if (e instanceof InputError) {
      report = {
        valid: false,
        skillPath: opts.skill ?? null,
        casesPath: opts.cases ?? null,
        checksRun: 1,
        findings: [{ level: "error", check: "configuration", message: e.message }],
      };
    } else {
      throw e;
    }
  }

  if (opts.json) {
    io.out(JSON.stringify(report, null, 2));
  } else {
    const color = colorEnabled({ json: false });
    if (!opts.quiet) {
      io.out(`Validating skill: ${report.skillPath ?? "(unspecified)"}`);
      io.out(`Validating cases: ${report.casesPath ?? "(unspecified)"}`);
    }
    for (const f of report.findings) {
      const tag = f.level === "error" ? red(color, "ERROR") : yellow(color, "WARN ");
      io.out(`  ${tag} [${f.check}] ${f.message}`);
    }
    io.out(
      report.valid
        ? green(color, `Valid. ${report.checksRun} checks completed, no errors.`)
        : red(color, `Invalid. ${report.findings.filter((f) => f.level === "error").length} error(s) found.`),
    );
  }

  return report.valid ? 0 : 2;
}
