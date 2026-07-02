# Verification Rules

How outputs of the `glossary` skill are graded. Each run is judged by the same
four validators as every skill in this template; a run passes only if **all**
pass. Implementation lives in `src/validators/`.

## 1. Schema (`schema`)

The output must match the required JSON shape (`src/validators/schema-validator.ts`):
`status` in the allowed enum, `answer` a string, `claims` an array of
`{ text, citations[] }`, `toolCalls` an array of `{ tool, arguments }`, optional
`confidence`. Citations must have a non-empty `file` and a positive integer `line`.

## 2. Citation (`citation`)

Keyword-based (non-semantic) grounding checks against the Wikipedia snapshot:

- **Existence** — each cited snapshot file exists and each line number is in range.
- **Support** — for every claim that has citations, at least one cited line shares
  a significant keyword with the claim text. (The validator also derives CJK
  bigrams, so non-English content can be grounded too; see
  `src/validators/citation-validator.ts`.)
- **Required symbols** (answered only) — the queried term (a `requiredSymbol`)
  appears verbatim on a cited line. The snapshot's `lede` line is authored to
  always contain the exact query term, so this holds even when the canonical
  article title differs from the query.
- **Expected files** (answered only) — the term's snapshot is the cited file.

> MVP limitation: this is substring/keyword matching, not semantic understanding.

## 3. Unsupported claim (`unsupported_claim`)

Honesty policy:

- **Forbidden claims** — no `forbiddenClaim` from the test case may appear.
- **Status discipline** — the model must return `insufficient_evidence` for a term
  with no cached snapshot, and must answer when a snapshot exists.
- **Grounding presence** — when `status = answered`, there must be at least one
  claim and every claim must carry at least one citation.

## 4. Tool call (`tool_call`)

- **Required tools** — `wikipedia_search` (and, when answered, `wikipedia_fetch`)
  were called.
- **Order** — `wikipedia_search` must precede `wikipedia_fetch` (contract
  `toolOrder`).

## Test case fields

Each case in `testcases/glossary*.json` provides the grading key:

| Field | Meaning |
| --- | --- |
| `expectedStatus` | The correct status for this request. |
| `requiredSymbols` | The queried term, which must appear on a cited line. |
| `forbiddenClaims` | Substrings that must not appear (hallucination guards). |
| `requiredTools` | Tools that must be called. |
| `expectedCitationFiles` | The snapshot file that must be cited. |
| `minPassRate` | Optional per-case floor (defaults to the global threshold). |

Negative cases live in `testcases/glossary-negative.json` (per-skill negatives
override the shared `negative-cases.json`).

## Repeated runs & gate

Every case runs N times (default 10). Rates are computed across all runs. The
release gate passes only when the overall pass rate clears the threshold **and**
every case clears its own floor. See `docs/verification-pipeline.md`.
