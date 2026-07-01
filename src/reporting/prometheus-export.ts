import type { EvalSummary } from "./summary-json.js";

/**
 * Prometheus text-format exporter (a simple, dependency-free exporter — not
 * prom-client). Emits one snapshot per eval run. In a long-running service these
 * would be live gauges/counters scraped by Prometheus; here they are a static
 * snapshot suitable for `textfile`-collector style ingestion or inspection.
 *
 * Token, cost, and latency values are DEMO/ESTIMATED for the mock adapters.
 */

interface Metric {
  name: string;
  help: string;
  type: "counter" | "gauge";
  value: number;
}

function escapeLabel(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

export function toPrometheus(summary: EvalSummary): string {
  const labels = `{skill="${escapeLabel(summary.skill.name)}",model="${escapeLabel(
    summary.model.name,
  )}"}`;
  const m = summary.metrics;

  const metrics: Metric[] = [
    { name: "skill_run_total", help: "Total skill runs executed.", type: "counter", value: m.totalRuns },
    { name: "skill_pass_rate", help: "Fraction of runs that passed all validators.", type: "gauge", value: m.passRate },
    { name: "skill_schema_valid_rate", help: "Fraction of runs with a schema-valid output.", type: "gauge", value: m.schemaValidRate },
    { name: "skill_citation_valid_rate", help: "Fraction of runs with valid citations.", type: "gauge", value: m.citationValidRate },
    { name: "skill_unsupported_claim_rate", help: "Fraction of runs with an unsupported claim (lower is better).", type: "gauge", value: m.unsupportedClaimRate },
    { name: "skill_tool_error_rate", help: "Fraction of runs violating the tool contract (lower is better).", type: "gauge", value: m.toolErrorRate },
    { name: "skill_retry_count", help: "Total retries performed across runs.", type: "counter", value: m.retryCount },
    { name: "skill_latency_ms_p50", help: "P50 latency in ms (estimated/demo).", type: "gauge", value: m.latencyMsP50 },
    { name: "skill_latency_ms_p95", help: "P95 latency in ms (estimated/demo).", type: "gauge", value: m.latencyMsP95 },
    { name: "skill_latency_ms_p99", help: "P99 latency in ms (estimated/demo).", type: "gauge", value: m.latencyMsP99 },
    { name: "skill_token_input_total", help: "Total input tokens (estimated/demo).", type: "counter", value: m.tokenInputTotal },
    { name: "skill_token_output_total", help: "Total output tokens (estimated/demo).", type: "counter", value: m.tokenOutputTotal },
    { name: "skill_estimated_cost", help: "Estimated cost in USD (demo pricing).", type: "gauge", value: m.estimatedCostUsd },
  ];

  const lines: string[] = [
    "# Agent Skill Verification metrics (snapshot).",
    "# NOTE: token/cost/latency are estimated/demo values for the offline mock adapters.",
    "",
  ];
  for (const metric of metrics) {
    lines.push(`# HELP ${metric.name} ${metric.help}`);
    lines.push(`# TYPE ${metric.name} ${metric.type}`);
    lines.push(`${metric.name}${labels} ${metric.value}`);
    lines.push("");
  }
  return `${lines.join("\n")}`;
}
