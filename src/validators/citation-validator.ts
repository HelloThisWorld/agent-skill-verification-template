import { readFileSync } from "node:fs";
import { resolveFromRoot } from "../core/paths.js";
import type { ValidatorResult } from "../core/types.js";
import type { ValidatorInput } from "./validation-summary.js";
import { truncate, VALIDATOR_NAMES } from "./validation-summary.js";

/**
 * Citation validator — checks that every citation is real and relevant.
 *
 * This is deliberately KEYWORD-based, not semantic (a documented MVP limitation;
 * richer semantic validation is a roadmap item). Concretely it checks:
 *   - the cited file exists and the line number is in range;
 *   - each claim that has citations is "supported" — at least one cited line
 *     contains at least one significant keyword from the claim text;
 *   - when the skill answers, every `requiredSymbol` appears on some cited line
 *     and every `expectedCitationFile` is actually cited.
 */

/**
 * Extract significant keywords for keyword-based support checking:
 *   - CamelCase identifiers (strong signal for code),
 *   - ASCII words of length >= 4,
 *   - CJK bigrams (adjacent character pairs) so non-space-delimited languages
 *     like Chinese can be grounded too. A cited line "supports" a CJK claim when
 *     it shares at least one 2-character sequence with it.
 * Adding CJK grams is purely additive: ASCII-only text yields no CJK grams, so
 * the existing codebase-understanding behavior is unchanged.
 */
function keywords(text: string): string[] {
  const strong = (text.match(/\b[A-Z][a-z0-9]+(?:[A-Z][a-z0-9]*)+\b/g) ?? []).map((s) =>
    s.toLowerCase(),
  );
  const words = (text.toLowerCase().match(/[a-z][a-z0-9]+/g) ?? []).filter((w) => w.length >= 4);
  const cjk: string[] = [];
  // CJK Ext-A (3400-4DBF), Unified (4E00-9FFF), Compatibility (F900-FAFF).
  for (const run of text.match(/[㐀-鿿豈-﫿]+/g) ?? []) {
    if (run.length === 1) cjk.push(run);
    for (let i = 0; i + 1 < run.length; i++) cjk.push(run.slice(i, i + 2));
  }
  return [...new Set([...strong, ...words, ...cjk])];
}

export function validateCitations(input: ValidatorInput): ValidatorResult {
  const { output, testCase } = input;
  const reasons: string[] = [];

  // Cache file contents so we read each cited file at most once.
  const fileCache = new Map<string, string[] | null>();
  const linesOf = (file: string): string[] | null => {
    if (fileCache.has(file)) return fileCache.get(file) ?? null;
    let lines: string[] | null;
    try {
      lines = readFileSync(resolveFromRoot(file), "utf8").split(/\r?\n/);
    } catch {
      lines = null;
    }
    fileCache.set(file, lines);
    return lines;
  };

  const citedFiles = new Set<string>();
  const citedLineText: string[] = [];

  // 1. Existence checks.
  for (const claim of output.claims) {
    for (const c of claim.citations) {
      const lines = linesOf(c.file);
      if (!lines) {
        reasons.push(`citation_file_not_found: ${c.file}`);
        continue;
      }
      if (c.line < 1 || c.line > lines.length) {
        reasons.push(`citation_line_out_of_range: ${c.file}:${c.line}`);
        continue;
      }
      citedFiles.add(c.file);
      citedLineText.push(lines[c.line - 1]);
    }
  }

  // 2. Support check: each claim with citations must have a supporting line.
  for (const claim of output.claims) {
    if (claim.citations.length === 0) continue;
    const kws = keywords(claim.text);
    const supported = claim.citations.some((c) => {
      const lines = linesOf(c.file);
      if (!lines || c.line < 1 || c.line > lines.length) return false;
      const lineLow = lines[c.line - 1].toLowerCase();
      return kws.some((k) => lineLow.includes(k));
    });
    if (!supported) {
      reasons.push(`citation_does_not_support_claim: "${truncate(claim.text)}"`);
    }
  }

  // 3. Answered-only expectations from the test case.
  if (output.status === "answered") {
    for (const symbol of testCase.requiredSymbols) {
      const found = citedLineText.some((line) =>
        line.toLowerCase().includes(symbol.toLowerCase()),
      );
      if (!found) reasons.push(`required_symbol_not_cited: ${symbol}`);
    }
    for (const file of testCase.expectedCitationFiles) {
      if (!citedFiles.has(file)) reasons.push(`expected_citation_file_not_cited: ${file}`);
    }
  }

  return {
    validator: VALIDATOR_NAMES.citation,
    passed: reasons.length === 0,
    reasons,
    details: { citedFiles: [...citedFiles] },
  };
}
