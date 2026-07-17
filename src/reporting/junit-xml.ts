import type { CanonicalResult } from "../core/canonical-result.js";

/**
 * JUnit XML report derived from the canonical verification result.
 *
 * One <testcase> per evaluation case; a case that misses its pass-rate floor
 * gets a <failure> element whose text lists the aggregated failure reasons.
 * All user-controlled strings (case names, reasons) are XML-escaped, and
 * control characters are stripped so the document stays well-formed.
 */

// XML 1.0 forbids most C0 control characters; strip them before escaping.
// eslint-disable-next-line no-control-regex
const XML_CONTROL_CHARS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g;

function escapeXml(input: unknown): string {
  return String(input)
    .replace(XML_CONTROL_CHARS, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function pct(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

export function buildJUnitXml(result: CanonicalResult): string {
  const failedCases = result.caseResults.filter((c) => c.result === "failed");
  const reasonsByCase = new Map<string, Map<string, number>>();
  for (const failed of result.failedRuns) {
    const byReason = reasonsByCase.get(failed.testCaseId) ?? new Map<string, number>();
    for (const reason of failed.failureReasons) {
      byReason.set(reason, (byReason.get(reason) ?? 0) + 1);
    }
    reasonsByCase.set(failed.testCaseId, byReason);
  }

  const lines: string[] = [];
  lines.push(`<?xml version="1.0" encoding="UTF-8"?>`);
  lines.push(
    `<testsuites name="${escapeXml(result.tool.name)}" tests="${result.caseResults.length}" ` +
      `failures="${failedCases.length}" errors="0" time="0">`,
  );
  lines.push(
    `  <testsuite name="${escapeXml(result.skill.name)}" tests="${result.caseResults.length}" ` +
      `failures="${failedCases.length}" errors="0" skipped="0" timestamp="${escapeXml(result.createdAt)}" time="0">`,
  );

  for (const c of result.caseResults) {
    const classname = `${result.skill.name}.${c.kind}`;
    const open = `    <testcase classname="${escapeXml(classname)}" name="${escapeXml(`${c.id}: ${c.name}`)}" time="0"`;
    if (c.result === "passed") {
      lines.push(`${open}/>`);
      continue;
    }
    const message = `pass rate ${pct(c.passRate)} is below the required floor ${pct(c.minPassRate)} (${c.failedRuns} of ${c.runs} runs failed)`;
    const reasonLines = [...(reasonsByCase.get(c.id)?.entries() ?? [])]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([reason, count]) => `${count}x ${reason}`);
    lines.push(`${open}>`);
    lines.push(`      <failure message="${escapeXml(message)}" type="QualityGateFailure">`);
    lines.push(escapeXml(reasonLines.join("\n") || "no individual run failures recorded"));
    lines.push(`      </failure>`);
    lines.push(`    </testcase>`);
  }

  lines.push(`  </testsuite>`);
  lines.push(`</testsuites>`);
  return `${lines.join("\n")}\n`;
}
