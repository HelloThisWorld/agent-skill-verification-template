# Observability Model

The template treats each skill run as something you can debug after the fact. It
produces four observability outputs. This document is explicit about **what is
real and what is simplified demo telemetry**, so nothing here is overclaimed.

## 1. Structured logs (real)

`reports/latest/structured-events.jsonl` — one JSON object per line. Every event
carries identity fields (`run_id`, `skill_name`, `skill_version`, `model_name`,
`test_case_id`, `attempt_index`, `prompt_version`, `tool_schema_version`) plus
event-specific fields. Implementation: `src/telemetry/logger.ts`.

Example:

```json
{"timestamp":"...","event":"citation_validation_failed","run_id":"run_ab12_0003","skill_name":"codebase-understanding","skill_version":"1.0.0","model_name":"mock-flaky","test_case_id":"cu_welcome_notification","failure_reason":"citation_does_not_support_claim","prompt_version":"p1","tool_schema_version":"s1"}
```

## 2. Trace-like spans (demo telemetry)

Each run is modeled as a trace with these spans:

```
skill.run
├─ input.normalization
├─ tool.selection
├─ tool.execution
├─ output.generation
├─ schema.validation
├─ citation.validation
├─ unsupported_claim.validation
├─ tool_call.validation
└─ final.decision
```

**What's real:** spans are captured with the OpenTelemetry trace/span id format
(16-byte trace id, 8-byte span id), parent/child nesting, attributes, and events.
They are embedded in each run record and replay artifact. Implementation:
`src/telemetry/tracing.ts`.

**What's simplified:** spans are captured as plain JSON, **not exported to a live
OTEL collector**. A real OTLP exporter is a roadmap item. The shape is kept close
to OTEL so that swap is small.

## 3. Metrics (real computation, demo cost/latency)

`reports/latest/metrics.prom` — Prometheus text format
(`src/reporting/prometheus-export.ts`), plus the same numbers in `summary.json`.

| Metric | Source |
| --- | --- |
| `skill_run_total`, `skill_pass_rate` | exact over the runs |
| `skill_schema_valid_rate`, `skill_citation_valid_rate` | exact |
| `skill_unsupported_claim_rate`, `skill_tool_error_rate` | exact (lower is better) |
| `skill_retry_count` | exact (0 by default; retries not enabled) |
| `skill_latency_ms_p50/p95/p99` | **estimated/demo** (deterministic mock latency) |
| `skill_token_input_total`, `skill_token_output_total` | **estimated** (~4 chars/token) |
| `skill_estimated_cost` | **demo pricing** (see `src/core/thresholds.ts`) |

This is a simple text exporter, not `prom-client`.

## 4. Replay artifacts (real)

One JSON file per failed run under `reports/latest/replay-artifacts/`. See
`docs/replay-artifacts.md`.

## Optional Grafana stack (demo / direction)

`observability/` contains a `docker-compose.yml` (OTEL Collector → Prometheus →
Grafana), collector/prometheus configs, and a Grafana dashboard. It documents the
intended production topology. Because the harness does not yet push live OTLP, the
stack is not wired to the app by default; to ingest today's `metrics.prom` snapshot
you would point the Prometheus node_exporter **textfile** collector at it. Live
push is a roadmap item.

The static HTML report works with **none** of this stack.
