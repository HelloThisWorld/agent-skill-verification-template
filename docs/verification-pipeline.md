# Verification Pipeline

How a single question becomes a graded, observable, replayable run.

```
TestCase ──► normalize input ──► Model Adapter ──► SkillOutput
                                     │ (repo_search, read_file)
                                     ▼
                              Validators (schema, citation,
                              unsupported_claim, tool_call)
                                     ▼
                        ValidationSummary (passed + reasons)
                                     ▼
        Telemetry (spans + structured logs) · Metrics · Replay artifact
```

## Stages

1. **Load contract** — `skills/<skill>/skill-contract.json`, validated with zod on
   load (`src/core/skill-contract.ts`).
2. **Load test cases** — `testcases/<skill>.json` (happy) + `testcases/negative-cases.json`.
3. **Per attempt** (`src/core/eval-runner.ts`):
   - Normalize the input (trim/collapse whitespace).
   - Call the model adapter, which uses `repo_search`/`read_file` and returns a `SkillOutput`.
   - Run the four validators, each wrapped in a span.
   - Combine into a `ValidationSummary` (pass = all validators pass).
4. **Aggregate** — compute metrics, per-case pass rates, failure breakdown.
5. **Gate** — see below.
6. **Report** — write `summary.json`, `report.html`, `metrics.prom`,
   `structured-events.jsonl`, and one replay artifact per failed run.

## Validators

| Validator | Checks |
| --- | --- |
| `schema` | Output matches the required JSON shape. |
| `citation` | Cited `file:line` exists and supports the claim; required symbols/files cited. |
| `unsupported_claim` | No forbidden claims; correct status discipline; answered claims are cited. |
| `tool_call` | Required tools called; `repo_search` before `read_file`. |

Details in `skills/codebase-understanding/verification-rules.md`.

## Negative cases

Negative cases are first-class. They assert the skill *declines* to answer
(`insufficient_evidence`) for non-existent symbols/services and genuinely
ambiguous questions, and they carry hallucination guards (`forbiddenClaims`). A
skill that "answers everything" fails these.

## Repeated runs

Each case runs N times (default 10, `--runs`). Because model behavior varies, a
single green run is not evidence of reliability — rates across many runs are. The
offline `mock` adapter is deterministic (100% by construction); the `mock-flaky`
adapter varies to exercise the failure paths.

## Release gate

`src/core/thresholds.ts`. The run set is **PASSED** only when:

- overall pass rate ≥ `--threshold` (default 0.9), **and**
- every test case's pass rate ≥ its `minPassRate` (or the global threshold).

The CLI exits non-zero on gate failure (unless `--no-gate`), which is what makes
CI fail the build. See `.github/workflows/skill-eval.yml`.
