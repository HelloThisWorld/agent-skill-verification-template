# Verification Rules

How outputs of the `codebase-understanding` skill are graded. Each run is judged
by four validators; a run passes only if **all** pass. Implementation lives in
`src/validators/`.

## 1. Schema (`schema`)

The output must match the required JSON shape (`src/validators/schema-validator.ts`):
`status` in the allowed enum, `answer` a string, `claims` an array of
`{ text, citations[] }`, `toolCalls` an array of `{ tool, arguments }`, optional
`confidence`. Citations must have a non-empty `file` and a positive integer `line`.

## 2. Citation (`citation`)

Keyword-based (non-semantic) grounding checks:

- **Existence** — each cited file exists and each line number is in range.
- **Support** — for every claim that has citations, at least one cited line
  contains a significant keyword from the claim text.
- **Required symbols** (answered only) — every `requiredSymbol` from the test case
  appears on some cited line.
- **Expected files** (answered only) — every `expectedCitationFile` is cited.

> MVP limitation: this is substring/keyword matching, not semantic understanding.
> Richer semantic citation validation is on the roadmap.

## 3. Unsupported claim (`unsupported_claim`)

Honesty policy:

- **Forbidden claims** — no `forbiddenClaim` from the test case may appear in the
  answer or any claim (hallucination guard).
- **Status discipline** — the model must not answer when the expected behavior is
  `insufficient_evidence`, and must answer when it should.
- **Grounding presence** — when `status = answered`, there must be at least one
  claim and every claim must carry at least one citation.

## 4. Tool call (`tool_call`)

- **Required tools** — every `requiredTool` from the test case was called.
- **Order** — adjacent tools in the contract's `toolOrder` must appear in order
  when both are used (`repo_search` before `read_file`).

## Test case fields

Each case in `testcases/*.json` provides the grading key:

| Field | Meaning |
| --- | --- |
| `expectedStatus` | The correct status for this question. |
| `requiredSymbols` | Symbols that must appear on a cited line. |
| `forbiddenClaims` | Substrings that must not appear (hallucination guards). |
| `requiredTools` | Tools that must be called. |
| `expectedCitationFiles` | Files that must be cited. |
| `minPassRate` | Optional per-case floor (defaults to the global threshold). |

## Repeated runs & gate

Every case runs N times (default 10). Rates are computed across all runs. The
release gate passes only when the overall pass rate clears the threshold **and**
every case clears its own floor. See `docs/verification-pipeline.md`.
