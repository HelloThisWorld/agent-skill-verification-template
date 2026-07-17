import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { readStructuredFile } from "../../core/case-loader.js";
import {
  canonicalToEvalSummary,
  parseCanonicalResult,
  type CanonicalResult,
} from "../../core/canonical-result.js";
import { ArtifactError, InputError, errorMessage } from "../../core/errors.js";
import { repoRoot } from "../../core/paths.js";
import { buildHtmlReport } from "../../reporting/html-report.js";
import { buildJUnitXml } from "../../reporting/junit-xml.js";
import { bold, colorEnabled, green, red, type CliIo } from "../io.js";

/**
 * `agent-skill-verifier report` — convert a canonical `summary.json` into
 * another report format. Never reruns any evaluation.
 */

export interface ReportCliOptions {
  input?: string;
  format?: string;
  output?: string;
  json?: boolean;
}

const FORMATS = ["terminal", "json", "junit", "html"] as const;
type ReportFormat = (typeof FORMATS)[number];

function pct(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function terminalReport(canonical: CanonicalResult): string {
  const color = colorEnabled({ json: false });
  const resultText =
    canonical.summary.result === "passed" ? green(color, "PASSED") : red(color, "FAILED");
  const lines = [
    bold(color, `Verification report — ${canonical.skill.name} v${canonical.skill.version}`),
    `  Generated:     ${canonical.createdAt}`,
    `  Adapter:       ${canonical.configuration.adapter}`,
    `  Cases:         ${canonical.summary.cases}`,
    `  Total runs:    ${canonical.summary.totalRuns}`,
    `  Pass rate:     ${pct(canonical.summary.passRate)} (threshold ${pct(canonical.configuration.threshold)})`,
    `  Flaky cases:   ${canonical.summary.flakyCases}`,
    `  Result:        ${resultText}`,
  ];
  if (canonical.gate.reasons.length > 0) {
    lines.push(`  Gate reasons:  ${canonical.gate.reasons.join("; ")}`);
  }
  lines.push("", "  Per-case results:");
  for (const c of canonical.caseResults) {
    const tag = c.result === "passed" ? green(color, "pass") : red(color, "FAIL");
    lines.push(`    ${tag}  ${c.id}  ${pct(c.passRate)} (floor ${pct(c.minPassRate)})`);
  }
  return lines.join("\n");
}

export function runReportCommand(io: CliIo, opts: ReportCliOptions): number {
  if (!opts.input) {
    throw new InputError("Missing --input <summary.json> (a canonical verification result).");
  }
  const format = (opts.format ?? (opts.json ? "json" : "terminal")) as string;
  if (!(FORMATS as readonly string[]).includes(format)) {
    throw new InputError(`--format must be one of: ${FORMATS.join(", ")} (got "${format}").`);
  }

  const inputAbs = resolve(repoRoot(), opts.input);
  const raw = readStructuredFile(inputAbs, "Canonical verification result");
  let canonical: CanonicalResult;
  try {
    canonical = parseCanonicalResult(raw, inputAbs);
  } catch (error) {
    throw new InputError(errorMessage(error));
  }

  let content: string;
  switch (format as ReportFormat) {
    case "terminal":
      content = terminalReport(canonical);
      break;
    case "json":
      content = JSON.stringify(canonical, null, 2);
      break;
    case "junit":
      content = buildJUnitXml(canonical);
      break;
    case "html":
      content = buildHtmlReport(canonicalToEvalSummary(canonical));
      break;
  }

  if (opts.output) {
    const outAbs = resolve(repoRoot(), opts.output);
    try {
      mkdirSync(dirname(outAbs), { recursive: true });
      writeFileSync(outAbs, content.endsWith("\n") ? content : `${content}\n`, "utf8");
    } catch (error) {
      throw new ArtifactError(`Failed to write report to ${outAbs}: ${errorMessage(error)}`);
    }
    io.out(`Wrote ${format} report to ${outAbs}`);
  } else {
    io.out(content);
  }
  return 0;
}
