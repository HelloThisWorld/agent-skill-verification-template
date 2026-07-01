# Replay Artifacts

A replay artifact is a self-contained record of a single **failed** run, written
to `reports/latest/replay-artifacts/<runId>.json`. The goal: understand and
re-examine a failure without re-running anything and without reading logs.

Implementation: `src/artifacts/replay-artifact.ts`.

## Fields

| Field | Description |
| --- | --- |
| `runId`, `traceId` | Identity of the run / its trace. |
| `skillName`, `skillVersion` | Skill under test. |
| `modelName`, `modelType` | Adapter that produced the output. |
| `testCaseId`, `attemptIndex` | Which case and which of the N attempts. |
| `input`, `normalizedInput` | Raw and normalized question. |
| `modelOutput` | Raw model output as returned (serialized string). |
| `parsedOutput` | The parsed/typed output the validators inspected. |
| `toolCalls` | Full recorded tool trace (order, timing, success). |
| `validationResult` | Per-validator results and combined verdict. |
| `failureReasons` | Flat list of human-readable failure reasons. |
| `timestamps` | `startedAt` / `endedAt`. |
| `skillContractVersion`, `promptVersion`, `toolSchemaVersion` | Versioning for traceability. |
| `modelConfig` | Deterministic seed + adapter info. **No secrets.** |
| `spans` | The trace-like spans for this run. |

## Safety

Artifacts contain **only fixture data** — no secrets, no real user data. The
`modelConfig` block intentionally records just a deterministic seed and adapter
metadata. The test suite asserts artifacts contain no `api_key`/`password`
strings.

## Why raw vs. parsed output

`modelOutput` is the raw serialized output; `parsedOutput` is what the validators
saw. For the mock adapters these are equivalent, but the distinction matters for
real adapters where the model returns text that must be parsed into JSON — a parse
failure is itself a common, debuggable failure mode.

## Using an artifact

1. Open the JSON for a failed `runId` (listed in the HTML report's *Replay
   artifacts* table).
2. Read `failureReasons` for the "what".
3. Inspect `parsedOutput` + `toolCalls` for the "why".
4. Reproduce deterministically with the mock adapters using `modelConfig.seed`
   (`<testCaseId>#<attemptIndex>`).
