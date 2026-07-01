# Agent Skill Verification Template

> A production-oriented template for building observable, replayable, and
> verification-gated AI agent skills.

![status](https://img.shields.io/badge/status-MVP-blue)
![offline](https://img.shields.io/badge/default%20demo-offline-success)
![language](https://img.shields.io/badge/TypeScript-Node.js-informational)
![license](https://img.shields.io/badge/license-MIT-green)

Most agent skills are evaluated like black boxes: run the prompt, eyeball the
final answer, and hope it behaves consistently next time. This template treats an
agent skill as a **production software component** — something you test repeatedly,
validate structurally, trace, measure, replay on failure, and gate before release.

The default demo runs **fully offline** with a deterministic mock model. No API
keys, no network, no paid services.

<p align="center">
  <img src="docs/images/report-passed.svg" alt="Agent Skill Verification report showing a 100% pass rate, all validators green, across 7 test cases" width="860">
</p>

---

## The problem

An agent skill should not ship just because it worked once in a demo.
Final-output inspection is not enough. Reliable skills need:

- **repeated evaluation** (behavior varies run to run),
- **structured validation** (schema, source-grounding, tool usage — not vibes),
- **traces and metrics** (so you can debug and track regressions),
- **replay artifacts** (so a failure is reproducible, not a mystery),
- **quality gates** (so regressions fail the build, not production).

## What this repo demonstrates

- A Claude-style **skill structure** (`skills/codebase-understanding/`)
- A machine-readable **skill contract** (input/output/tool/citation rules)
- A **model adapter** abstraction (mock, flaky, and stub adapters)
- An **eval harness** that runs each case N times
- **Source-grounding validation** (every claim must cite `file:line`)
- **Structured logs** (JSONL), **metrics** (Prometheus text), and **trace-like spans**
- **Replay artifacts** for every failed run
- A polished, self-contained **static HTML report**
- An optional **OpenTelemetry / Prometheus / Grafana** stack (demo-level)
- A **CI quality gate** (GitHub Actions)

Honesty note: features that are stubs or demo-level are labeled as such here and
in `docs/`. Nothing in this README is overclaimed.

---

## Quickstart

```bash
npm install
npm run eval
# then open the generated report:
open reports/latest/report.html      # macOS
# start reports/latest/report.html   # Windows
# xdg-open reports/latest/report.html# Linux
```

To see failures, replay artifacts, and a failed gate in action:

```bash
npm run eval:flaky
```

## Example terminal output

<img src="docs/images/terminal-eval.svg" alt="Terminal output of npm run eval showing a 100% pass rate and a PASSED result" width="660">

```
Running eval — skill=codebase-understanding model=mock runs=10 threshold=0.9

==================== Eval Summary ====================
  Skill:                 codebase-understanding v1.0.0
  Model:                 mock (offline-deterministic)
  Test cases:            7
  Runs per case:         10
  Total runs:            70
  Pass rate:             100.0%
  Schema valid rate:     100.0%
  Citation valid rate:   100.0%
  Unsupported claim rate:0.0%
  Tool error rate:       0.0%
  P95 latency:           143 ms (estimated)
  Result:                PASSED
  Report:                reports/latest/report.html
======================================================
```

The `mock-flaky` adapter instead produces a mixed pass rate, a `FAILED` result,
a failure breakdown, and one replay artifact per failed run.

## Report

The eval writes a single self-contained `report.html` (no server, no CDN). The
images here are rendered from real run data; open `reports/latest/report.html`
after a run to explore the live version, including a link to every replay artifact.

The passing `npm run eval` report is shown near the top of this README. Running
`npm run eval:flaky` uses the `mock-flaky` adapter, which fails the release gate
and produces a per-reason failure breakdown:

<p align="center">
  <img src="docs/images/report-failed.svg" alt="Failing report showing a 54.3% pass rate, a FAILED result, and a failure breakdown grouped by reason" width="860">
</p>

---

## Architecture

```
Skill Contract ─► Model Adapter ─► Eval Harness ─► Validators ─► Telemetry ─► Report ─► CI Gate
   (what)            (how)          (run N×)      (schema,       (logs,       (html,     (fail
                                                   citation,      spans,       json,      build
                                                   claims,        metrics)     prom)      below
                                                   tools)                                 threshold)
```

| Layer | Location | Responsibility |
| --- | --- | --- |
| Skill contract | `skills/`, `src/core/skill-contract.ts` | What the skill must do (model-independent). |
| Model adapter | `src/models/` | How a model is called (mock / flaky / stubs). |
| Tools | `src/tools/` | `repo_search`, `read_file`, recording registry. |
| Eval harness | `src/core/eval-runner.ts` | Run each case N×, orchestrate everything. |
| Validators | `src/validators/` | Schema, citation, unsupported-claim, tool-call. |
| Telemetry | `src/telemetry/` | Structured logs, trace-like spans, metrics. |
| Reporting | `src/reporting/`, `src/artifacts/` | summary.json, report.html, metrics.prom, replays. |
| CI gate | `.github/workflows/skill-eval.yml` | Fail the build below threshold. |

## Skill contract vs. model execution

This is the core idea, so it is worth stating plainly:

- The **skill contract is model-independent**. It describes what a correct answer
  looks like: the output schema, the citation requirement, the unsupported-claim
  policy, and the tool contract.
- The **reliability profile is model-dependent and must be measured**. Different
  models (or model versions, prompts, or tool schemas) will have different pass
  rates, latencies, costs, and failure patterns *against the same contract*.

That separation is why the model name is a first-class dimension on every metric,
log line, and report. See `docs/model-adapters.md`.

## Verification model

Every run is graded by four validators (all must pass):

1. **Schema** — output matches the required JSON structure.
2. **Citation** — each cited `file:line` exists and supports its claim; required
   symbols and files are cited. (Keyword-based for the MVP; semantic validation is
   on the roadmap.)
3. **Unsupported claim** — no forbidden/hallucinated claims; the model returns
   `insufficient_evidence` instead of inventing answers; answered claims are cited.
4. **Tool call** — required tools were called, and `repo_search` precedes `read_file`.

Plus: **negative cases** (must decline to answer), **repeated runs** (default 10
per case), and **threshold gates** (overall + per-case). Details in
`docs/verification-pipeline.md` and `skills/codebase-understanding/verification-rules.md`.

## Observability model

Each run produces:

- **Structured logs** — `reports/latest/structured-events.jsonl` (real).
- **Trace-like spans** — `skill.run` → tool selection/execution → output generation
  → validations → final decision. OpenTelemetry-shaped JSON (demo telemetry; a
  live OTLP exporter is a roadmap item).
- **Metrics** — `reports/latest/metrics.prom` and `summary.json`. Rates are exact;
  token/cost/latency are estimated/demo values for the mock adapters.
- **Replay artifacts** — one JSON per failed run under `replay-artifacts/`.

The **static report works by default**. The **Grafana stack in `observability/`
is optional** and **OpenTelemetry integration is demo-level** unless you implement
the exporter. See `docs/observability-model.md`.

---

## CLI

```bash
npm run eval -- \
  --skill codebase-understanding \
  --model mock \
  --runs 10 \
  --threshold 0.9 \
  --output reports/latest
```

| Flag | Default | Meaning |
| --- | --- | --- |
| `--skill` | `codebase-understanding` | Skill to evaluate. |
| `--model` | `mock` | `mock` \| `mock-flaky` \| `openai-stub` \| `anthropic-stub` \| `ollama-stub`. |
| `--runs` | `10` | Runs per test case. |
| `--threshold` | `0.9` | Release-gate pass-rate threshold (0..1). |
| `--output` | `reports/latest` | Report output directory. |
| `--no-gate` | (off) | Do not exit non-zero when the gate fails. |

The stub adapters do **not** call real APIs — they throw a clear, documented
error. The default demo uses the offline `mock` adapter.

## npm scripts

| Script | Description |
| --- | --- |
| `npm run build` | Type-check and compile with `tsc`. |
| `npm run test` | Run the vitest suite. |
| `npm run eval` | Run the eval with the **mock** adapter (offline). |
| `npm run eval:flaky` | Run with the **mock-flaky** adapter to demonstrate failures. |
| `npm run clean` | Remove `dist/` and generated reports. |

## Repository layout

```
skills/            Claude-style skill + machine-readable contract
testcases/         Happy-path and negative test cases
fixtures/          Synthetic sample repo the skill answers questions about
src/
  core/            Types, contract loader, eval runner, thresholds
  models/          Model adapters (mock, flaky, stubs)
  tools/           repo_search, read_file, recording registry
  validators/      Schema, citation, unsupported-claim, tool-call
  telemetry/       Logger, tracer, metrics
  reporting/       summary.json, report.html, metrics.prom writers
  artifacts/       Replay artifacts
  cli/             run-eval entry point
observability/     Optional OTEL Collector / Prometheus / Grafana (demo)
docs/              Design docs (verification, observability, replay, adapters)
tests/             vitest suites
```

## Requirements

- Node.js >= 18.18 (developed on Node 22).
- No API keys and no network for the default demo.

## Roadmap

Clearly future work, not implemented today:

- Real OpenTelemetry OTLP exporter (replace demo span JSON).
- Real Anthropic / OpenAI / Ollama adapters (behind the existing stubs).
- MCP server integration for tools.
- Claude Skill packaging examples.
- Richer **semantic** citation validation (beyond keyword matching).
- Committed dashboard screenshots and a model comparison matrix.
- A small web UI for browsing runs and artifacts.

## License

MIT — see [LICENSE](LICENSE).
