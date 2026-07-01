import { describe, expect, it } from "vitest";
import { loadSkillContract } from "../src/core/skill-contract.js";
import type { SkillOutput, TestCase } from "../src/core/types.js";
import { validateSchema } from "../src/validators/schema-validator.js";
import { validateCitations } from "../src/validators/citation-validator.js";
import { validateUnsupportedClaims } from "../src/validators/unsupported-claim-validator.js";
import { validateToolCalls } from "../src/validators/tool-call-validator.js";
import type { ValidatorInput } from "../src/validators/validation-summary.js";

const contract = loadSkillContract("codebase-understanding");
const UEP = "fixtures/sample-repo/src/UserEventPublisher.ts";

function tc(over: Partial<TestCase> = {}): TestCase {
  return {
    id: "t",
    name: "t",
    input: { question: "q" },
    kind: "happy",
    expectedStatus: "answered",
    requiredSymbols: [],
    forbiddenClaims: [],
    requiredTools: [],
    expectedCitationFiles: [],
    ...over,
  };
}

function out(over: Partial<SkillOutput> = {}): SkillOutput {
  return { status: "answered", answer: "a", claims: [], toolCalls: [], confidence: "high", ...over };
}

function input(output: SkillOutput, testCase: TestCase): ValidatorInput {
  return { output, testCase, contract };
}

describe("schema validator", () => {
  it("accepts a well-formed output", () => {
    const output = out({
      claims: [{ text: "UserCreatedEvent", citations: [{ file: UEP, line: 12 }] }],
      toolCalls: [{ tool: "repo_search", arguments: { query: "x" } }],
    });
    expect(validateSchema(input(output, tc())).passed).toBe(true);
  });

  it("rejects an invalid status enum", () => {
    const output = out({ status: "maybe" as unknown as SkillOutput["status"] });
    const result = validateSchema(input(output, tc()));
    expect(result.passed).toBe(false);
    expect(result.reasons.join(" ")).toContain("status");
  });

  it("rejects a citation with a non-numeric line", () => {
    const output = out({
      claims: [
        {
          text: "x",
          citations: [{ file: UEP, line: "12" as unknown as number }],
        },
      ],
    });
    expect(validateSchema(input(output, tc())).passed).toBe(false);
  });
});

describe("citation validator", () => {
  it("accepts a real, supporting citation", () => {
    const output = out({
      claims: [{ text: "UserEventPublisher publishes UserCreatedEvent.", citations: [{ file: UEP, line: 12 }] }],
    });
    const result = validateCitations(
      input(output, tc({ requiredSymbols: ["UserCreatedEvent"], expectedCitationFiles: [UEP] })),
    );
    expect(result.passed).toBe(true);
  });

  it("flags a non-existent file", () => {
    const output = out({
      claims: [{ text: "UserCreatedEvent", citations: [{ file: "fixtures/nope.ts", line: 1 }] }],
    });
    const result = validateCitations(input(output, tc()));
    expect(result.passed).toBe(false);
    expect(result.reasons.join(" ")).toContain("citation_file_not_found");
  });

  it("flags an out-of-range line", () => {
    const output = out({
      claims: [{ text: "UserCreatedEvent", citations: [{ file: UEP, line: 9999 }] }],
    });
    const result = validateCitations(input(output, tc()));
    expect(result.passed).toBe(false);
    expect(result.reasons.join(" ")).toContain("citation_line_out_of_range");
  });

  it("flags a citation that does not support the claim", () => {
    // Line 1 is a comment and does not contain "UserCreatedEvent".
    const output = out({
      claims: [{ text: "UserCreatedEvent is emitted here.", citations: [{ file: UEP, line: 1 }] }],
    });
    const result = validateCitations(input(output, tc()));
    expect(result.passed).toBe(false);
    expect(result.reasons.join(" ")).toContain("citation_does_not_support_claim");
  });

  it("flags a required symbol that is not on any cited line", () => {
    const output = out({
      claims: [{ text: "UserCreatedEvent", citations: [{ file: UEP, line: 12 }] }],
    });
    const result = validateCitations(input(output, tc({ requiredSymbols: ["welcome"] })));
    expect(result.passed).toBe(false);
    expect(result.reasons.join(" ")).toContain("required_symbol_not_cited");
  });
});

describe("unsupported-claim validator", () => {
  it("passes a grounded answer", () => {
    const output = out({
      claims: [{ text: "grounded", citations: [{ file: UEP, line: 12 }] }],
    });
    expect(validateUnsupportedClaims(input(output, tc())).passed).toBe(true);
  });

  it("flags a forbidden claim", () => {
    const output = out({
      answer: "This is handled by PaymentService.",
      claims: [{ text: "x", citations: [{ file: UEP, line: 12 }] }],
    });
    const result = validateUnsupportedClaims(input(output, tc({ forbiddenClaims: ["PaymentService"] })));
    expect(result.passed).toBe(false);
    expect(result.reasons.join(" ")).toContain("forbidden_claim_present");
  });

  it("flags an invented answer when insufficient_evidence is expected", () => {
    const output = out({ claims: [{ text: "x", citations: [{ file: UEP, line: 12 }] }] });
    const result = validateUnsupportedClaims(
      input(output, tc({ expectedStatus: "insufficient_evidence" })),
    );
    expect(result.passed).toBe(false);
    expect(result.reasons.join(" ")).toContain("invented_answer");
  });

  it("flags an answered claim with no citation", () => {
    const output = out({ claims: [{ text: "uncited", citations: [] }] });
    const result = validateUnsupportedClaims(input(output, tc()));
    expect(result.passed).toBe(false);
    expect(result.reasons.join(" ")).toContain("answered_claim_without_citation");
  });
});

describe("tool-call validator", () => {
  it("passes when required tools are called in order", () => {
    const output = out({
      toolCalls: [
        { tool: "repo_search", arguments: {} },
        { tool: "read_file", arguments: {} },
      ],
    });
    const result = validateToolCalls(
      input(output, tc({ requiredTools: ["repo_search", "read_file"] })),
    );
    expect(result.passed).toBe(true);
  });

  it("flags a missing required tool", () => {
    const output = out({ toolCalls: [{ tool: "repo_search", arguments: {} }] });
    const result = validateToolCalls(input(output, tc({ requiredTools: ["read_file"] })));
    expect(result.passed).toBe(false);
    expect(result.reasons.join(" ")).toContain("required_tool_not_called");
  });

  it("flags out-of-order tool calls", () => {
    const output = out({
      toolCalls: [
        { tool: "read_file", arguments: {} },
        { tool: "repo_search", arguments: {} },
      ],
    });
    const result = validateToolCalls(
      input(output, tc({ requiredTools: ["repo_search", "read_file"] })),
    );
    expect(result.passed).toBe(false);
    expect(result.reasons.join(" ")).toContain("tool_order_violation");
  });
});
