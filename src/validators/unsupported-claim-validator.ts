import type { ValidatorResult } from "../core/types.js";
import type { ValidatorInput } from "./validation-summary.js";
import { truncate, VALIDATOR_NAMES } from "./validation-summary.js";

/**
 * Unsupported-claim validator — enforces the skill's honesty policy.
 *
 *   - Forbidden claims: known hallucination markers from the test case must not
 *     appear anywhere in the answer or claims.
 *   - Status discipline: the model must not invent an answer when the correct
 *     behavior is `insufficient_evidence`, and must answer when it should.
 *   - Grounding: when the status is `answered`, there must be at least one claim
 *     and every claim must carry at least one citation. (Citation *validity* is
 *     the citation validator's job; this validator enforces citation *presence*.)
 */
export function validateUnsupportedClaims(input: ValidatorInput): ValidatorResult {
  const { output, testCase } = input;
  const reasons: string[] = [];

  const haystack = [output.answer, ...output.claims.map((c) => c.text)].join("\n").toLowerCase();
  for (const forbidden of testCase.forbiddenClaims) {
    if (forbidden && haystack.includes(forbidden.toLowerCase())) {
      reasons.push(`forbidden_claim_present: "${forbidden}"`);
    }
  }

  if (testCase.expectedStatus === "insufficient_evidence" && output.status === "answered") {
    reasons.push("invented_answer_when_insufficient_expected");
  }
  if (testCase.expectedStatus === "answered" && output.status !== "answered") {
    reasons.push(`expected_answer_but_got_${output.status}`);
  }

  if (output.status === "answered") {
    if (output.claims.length === 0) {
      reasons.push("answered_without_claims");
    }
    for (const claim of output.claims) {
      if (claim.citations.length === 0) {
        reasons.push(`answered_claim_without_citation: "${truncate(claim.text)}"`);
      }
    }
  }

  return {
    validator: VALIDATOR_NAMES.unsupportedClaim,
    passed: reasons.length === 0,
    reasons,
    details: { status: output.status, expectedStatus: testCase.expectedStatus },
  };
}
