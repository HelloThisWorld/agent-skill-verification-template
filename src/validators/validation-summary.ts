import type { SkillContract } from "../core/skill-contract.js";
import type { SkillOutput, TestCase, ValidationSummary, ValidatorResult } from "../core/types.js";

/** Everything a validator needs to judge a single run. */
export interface ValidatorInput {
  output: SkillOutput;
  testCase: TestCase;
  contract: SkillContract;
}

/** A validator is a pure function from a run to a result. */
export type Validator = (input: ValidatorInput) => ValidatorResult;

/** Shorten long strings for human-readable failure reasons. */
export function truncate(text: string, max = 80): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

/**
 * Canonical validator names. Used as the single source of truth so telemetry,
 * metrics, and reporting never drift from the validators themselves.
 */
export const VALIDATOR_NAMES = {
  schema: "schema",
  citation: "citation",
  unsupportedClaim: "unsupported_claim",
  toolCall: "tool_call",
} as const;

export type ValidatorName = (typeof VALIDATOR_NAMES)[keyof typeof VALIDATOR_NAMES];

/**
 * Fold per-validator results into a single verdict. A run passes only when every
 * validator passes. Failure reasons are prefixed with the validator name so they
 * read well in logs, reports, and replay artifacts.
 */
export function combineValidatorResults(results: ValidatorResult[]): ValidationSummary {
  const failureReasons: string[] = [];
  for (const r of results) {
    if (!r.passed) {
      for (const reason of r.reasons) {
        failureReasons.push(`${r.validator}: ${reason}`);
      }
    }
  }
  return {
    passed: failureReasons.length === 0,
    failureReasons,
    validators: results,
  };
}

/** Build the summary used when the model call itself failed (e.g. a stub adapter). */
export function erroredValidationSummary(message: string): ValidationSummary {
  const result: ValidatorResult = {
    validator: "model_call",
    passed: false,
    reasons: [message],
    details: { errored: true },
  };
  return { passed: false, failureReasons: [`model_call: ${message}`], validators: [result] };
}

export function findValidator(
  summary: ValidationSummary,
  name: string,
): ValidatorResult | undefined {
  return summary.validators.find((v) => v.validator === name);
}
