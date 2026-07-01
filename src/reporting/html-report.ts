import type { EvalSummary } from "./summary-json.js";

/**
 * Self-contained static HTML report. No external CDN, no server required — open
 * `reports/latest/report.html` directly in a browser. Styling is inline so the
 * single file is portable and screenshot-friendly.
 */

function esc(input: unknown): string {
  return String(input)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function pct(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function badge(result: "PASSED" | "FAILED"): string {
  const cls = result === "PASSED" ? "badge badge-pass" : "badge badge-fail";
  return `<span class="${cls}">${result}</span>`;
}

function card(label: string, value: string, sub = ""): string {
  return `
      <div class="card">
        <div class="card-label">${esc(label)}</div>
        <div class="card-value">${value}</div>
        ${sub ? `<div class="card-sub">${esc(sub)}</div>` : ""}
      </div>`;
}

function summaryCards(s: EvalSummary): string {
  const m = s.metrics;
  return [
    card("Overall result", badge(s.result), s.gateReasons[0] ?? "All gates satisfied"),
    card("Pass rate", pct(m.passRate), `${s.totals.passedRuns}/${s.totals.totalRuns} runs`),
    card("Schema valid", pct(m.schemaValidRate)),
    card("Citation valid", pct(m.citationValidRate)),
    card("Unsupported claim rate", pct(m.unsupportedClaimRate), "lower is better"),
    card("Tool error rate", pct(m.toolErrorRate), "lower is better"),
    card("P95 latency", `${m.latencyMsP95} ms`, "estimated/demo"),
    card("Total runs", String(m.totalRuns), `${s.totals.testCases} test cases`),
  ].join("");
}

function caseRows(s: EvalSummary): string {
  return s.perCase
    .map(
      (c) => `
        <tr>
          <td><code>${esc(c.id)}</code></td>
          <td>${esc(c.name)}</td>
          <td><span class="tag">${esc(c.kind)}</span></td>
          <td><code>${esc(c.expectedStatus)}</code></td>
          <td class="num">${pct(c.passRate)}</td>
          <td class="num">${pct(c.citationValidRate)}</td>
          <td class="num">${c.failureCount}</td>
          <td>${badge(c.result)}</td>
        </tr>`,
    )
    .join("");
}

function failureRows(s: EvalSummary): string {
  if (s.failureBreakdown.length === 0) {
    return `<tr><td colspan="2" class="empty">No failures — every run passed all validators.</td></tr>`;
  }
  return s.failureBreakdown
    .map(
      (f) => `
        <tr>
          <td><code>${esc(f.reason)}</code></td>
          <td class="num">${f.count}</td>
        </tr>`,
    )
    .join("");
}

function replayRows(s: EvalSummary): string {
  if (s.failedRuns.length === 0) {
    return `<tr><td colspan="3" class="empty">No failed runs — no replay artifacts generated.</td></tr>`;
  }
  return s.failedRuns
    .map(
      (r) => `
        <tr>
          <td><code>${esc(r.runId)}</code></td>
          <td><code>${esc(r.failureReasons[0] ?? "")}</code></td>
          <td><a href="${esc(r.artifact)}">${esc(r.artifact)}</a></td>
        </tr>`,
    )
    .join("");
}

export function buildHtmlReport(s: EvalSummary): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Agent Skill Verification Report — ${esc(s.skill.name)}</title>
<style>
  :root {
    --bg: #f5f7fa; --panel: #ffffff; --ink: #1a2233; --muted: #667085;
    --line: #e4e7ec; --accent: #3b5bdb; --pass-ink: #087443; --pass-bg: #e6f6ec;
    --fail-ink: #b42318; --fail-bg: #fdeceb; --code: #f2f4f7;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; background: var(--bg); color: var(--ink);
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    line-height: 1.5;
  }
  .wrap { max-width: 1040px; margin: 0 auto; padding: 32px 20px 64px; }
  header.hero {
    background: linear-gradient(135deg, #1e293b 0%, #3b5bdb 100%);
    color: #fff; border-radius: 16px; padding: 28px 32px; margin-bottom: 28px;
  }
  header.hero h1 { margin: 0 0 6px; font-size: 24px; letter-spacing: -0.01em; }
  header.hero .meta { color: #cdd6f4; font-size: 14px; }
  header.hero .meta code { background: rgba(255,255,255,0.15); color: #fff; }
  h2 { font-size: 15px; text-transform: uppercase; letter-spacing: 0.06em; color: var(--muted); margin: 32px 0 12px; }
  code { background: var(--code); padding: 1px 6px; border-radius: 5px; font-size: 12.5px;
    font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace; }
  .grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 14px; }
  .card { background: var(--panel); border: 1px solid var(--line); border-radius: 12px; padding: 16px; }
  .card-label { font-size: 12px; color: var(--muted); text-transform: uppercase; letter-spacing: 0.04em; }
  .card-value { font-size: 26px; font-weight: 650; margin-top: 6px; }
  .card-sub { font-size: 12px; color: var(--muted); margin-top: 4px; }
  .badge { display: inline-block; padding: 3px 12px; border-radius: 999px; font-size: 14px; font-weight: 700; }
  .badge-pass { color: var(--pass-ink); background: var(--pass-bg); }
  .badge-fail { color: var(--fail-ink); background: var(--fail-bg); }
  table { width: 100%; border-collapse: collapse; background: var(--panel);
    border: 1px solid var(--line); border-radius: 12px; overflow: hidden; }
  th, td { text-align: left; padding: 10px 14px; border-bottom: 1px solid var(--line); font-size: 13.5px; }
  th { background: #fafbfc; color: var(--muted); font-weight: 600; font-size: 12px;
    text-transform: uppercase; letter-spacing: 0.04em; }
  tr:last-child td { border-bottom: none; }
  td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; }
  .tag { font-size: 11px; background: var(--code); color: var(--muted); padding: 2px 8px; border-radius: 6px; }
  .empty { color: var(--muted); text-align: center; font-style: italic; }
  .profile { display: grid; grid-template-columns: repeat(4, 1fr); gap: 14px; }
  ul.notes { color: var(--muted); font-size: 13px; padding-left: 18px; }
  a { color: var(--accent); }
  footer { margin-top: 40px; color: var(--muted); font-size: 12px; text-align: center; }
</style>
</head>
<body>
  <div class="wrap">
    <header class="hero">
      <h1>Agent Skill Verification Report</h1>
      <div class="meta">
        Skill <code>${esc(s.skill.name)}</code> v${esc(s.skill.version)} &nbsp;·&nbsp;
        Model <code>${esc(s.model.name)}</code> (${esc(s.model.type)}) &nbsp;·&nbsp;
        Generated ${esc(s.generatedAt)}
      </div>
    </header>

    <h2>Summary</h2>
    <div class="grid">${summaryCards(s)}</div>

    <h2>Test cases</h2>
    <table>
      <thead>
        <tr>
          <th>Case</th><th>Scenario</th><th>Kind</th><th>Expected</th>
          <th class="num">Pass rate</th><th class="num">Citation valid</th>
          <th class="num">Failures</th><th>Result</th>
        </tr>
      </thead>
      <tbody>${caseRows(s)}</tbody>
    </table>

    <h2>Failure breakdown</h2>
    <table>
      <thead><tr><th>Failure reason</th><th class="num">Count</th></tr></thead>
      <tbody>${failureRows(s)}</tbody>
    </table>

    <h2>Model profile</h2>
    <div class="profile">
      ${card("Model", esc(s.model.name))}
      ${card("Adapter type", esc(s.model.type))}
      ${card("Runs per case", String(s.config.runsPerCase))}
      ${card("Threshold", pct(s.config.threshold))}
    </div>

    <h2>Replay artifacts</h2>
    <table>
      <thead><tr><th>Run id</th><th>First failure reason</th><th>Artifact</th></tr></thead>
      <tbody>${replayRows(s)}</tbody>
    </table>

    <h2>Notes</h2>
    <ul class="notes">
      ${s.notes.map((n) => `<li>${esc(n)}</li>`).join("")}
    </ul>

    <footer>
      Generated by the Agent Skill Verification Template · offline mock adapter · no external services required.
    </footer>
  </div>
</body>
</html>
`;
}
