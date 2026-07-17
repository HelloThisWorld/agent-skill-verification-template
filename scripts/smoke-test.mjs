import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

/**
 * Packaged-CLI smoke test. Runs the target (a standalone binary or the
 * bundled .cjs) from a temporary directory OUTSIDE the repository — no
 * node_modules, no repo checkout — and asserts the documented behavior:
 *
 *   --version / --help, validate, verify (reports written), and the
 *   exit-code contract (2 invalid input, 3 unknown adapter).
 *
 * Usage:
 *   node scripts/smoke-test.mjs [--target <path>]
 *
 * Default target: dist/sea/agent-skill-verifier[.exe] if present, else
 * dist/cli/agent-skill-verifier.cjs.
 */

const root = process.cwd();
const pkg = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));

const argv = process.argv.slice(2);
function argValue(flag) {
  const i = argv.indexOf(flag);
  return i !== -1 ? argv[i + 1] : undefined;
}

function defaultTarget() {
  const exe = process.platform === "win32" ? "agent-skill-verifier.exe" : "agent-skill-verifier";
  const standalone = resolve(root, "dist/sea", exe);
  if (existsSync(standalone)) return standalone;
  return resolve(root, "dist/cli/agent-skill-verifier.cjs");
}

const target = resolve(root, argValue("--target") ?? defaultTarget());
if (!existsSync(target)) {
  console.error(`Smoke target not found: ${target}`);
  process.exit(1);
}

const isCjs = target.endsWith(".cjs") || target.endsWith(".js");

const work = mkdtempSync(join(tmpdir(), "asv-smoke-"));
const failures = [];
let passed = 0;

function cli(args, options = {}) {
  const command = isCjs ? process.execPath : join(work, "bin", basenameOf(target));
  const fullArgs = isCjs ? [join(work, "bin", "agent-skill-verifier.cjs"), ...args] : args;
  return spawnSync(command, fullArgs, {
    cwd: work,
    encoding: "utf8",
    env: { ...process.env, CI: "true", NO_COLOR: "1" },
    ...options,
  });
}

function basenameOf(p) {
  return p.split(/[\\/]/).pop();
}

function check(name, condition, detail = "") {
  if (condition) {
    passed += 1;
    console.log(`  ok    ${name}`);
  } else {
    failures.push(name);
    console.error(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

try {
  // Stage an isolated workspace: the binary + fixtures, nothing else.
  mkdirSync(join(work, "bin"), { recursive: true });
  copyFileSync(target, join(work, "bin", basenameOf(target)));
  mkdirSync(join(work, "fixtures", "valid-skill", "corpus"), { recursive: true });
  copyFileSync(
    resolve(root, "fixtures/valid-skill/skill-contract.json"),
    join(work, "fixtures", "valid-skill", "skill-contract.json"),
  );
  for (const f of ["InvoiceService.ts", "PaymentGateway.ts", "README.md"]) {
    copyFileSync(
      resolve(root, `fixtures/valid-skill/corpus/${f}`),
      join(work, "fixtures", "valid-skill", "corpus", f),
    );
  }
  copyFileSync(resolve(root, "fixtures/evals.yaml"), join(work, "fixtures", "evals.yaml"));

  console.log(`Smoke-testing ${target}`);
  console.log(`  workspace: ${work} (outside the repository, no node_modules)`);

  const version = cli(["--version"]);
  check(
    "--version matches package version",
    version.status === 0 && version.stdout.trim() === pkg.version,
    `exit=${version.status} out="${version.stdout.trim()}"`,
  );

  const help = cli(["--help"]);
  check(
    "--help lists the commands",
    help.status === 0 &&
      ["verify", "validate", "replay", "report"].every((c) => help.stdout.includes(c)),
    `exit=${help.status}`,
  );

  const validate = cli([
    "validate",
    "--skill",
    "fixtures/valid-skill",
    "--cases",
    "fixtures/evals.yaml",
  ]);
  check("validate exits 0 on the fixture skill", validate.status === 0, `exit=${validate.status} ${validate.stderr}`);

  const verify = cli([
    "verify",
    "--skill",
    "fixtures/valid-skill",
    "--cases",
    "fixtures/evals.yaml",
    "--runs",
    "3",
    "--threshold",
    "0.9",
    "--adapter",
    "mock",
    "--output",
    "out",
  ]);
  check("verify exits 0 and passes the gate", verify.status === 0, `exit=${verify.status} ${verify.stderr}`);

  for (const file of ["summary.json", "junit.xml", "report.html", "events.jsonl", "metrics.json"]) {
    check(`verify wrote ${file}`, existsSync(join(work, "out", file)));
  }
  check("verify wrote replay artifacts", existsSync(join(work, "out", "replays", "case-001-run-01.json")));

  const summary = JSON.parse(readFileSync(join(work, "out", "summary.json"), "utf8"));
  check(
    "summary.json is canonical and version-consistent",
    summary.schemaVersion === "1.0.0" && summary.tool.version === pkg.version,
  );

  const jsonRun = cli([
    "verify",
    "--skill",
    "fixtures/valid-skill",
    "--cases",
    "fixtures/evals.yaml",
    "--runs",
    "1",
    "--json",
    "--output",
    "out-json",
  ]);
  const esc = String.fromCharCode(27);
  check(
    "--json output is parseable and ANSI-free",
    jsonRun.status === 0 && !jsonRun.stdout.includes(esc) && JSON.parse(jsonRun.stdout).schemaVersion === "1.0.0",
    `exit=${jsonRun.status}`,
  );

  const badAdapter = cli([
    "verify",
    "--skill",
    "fixtures/valid-skill",
    "--cases",
    "fixtures/evals.yaml",
    "--adapter",
    "nope",
  ]);
  check("unknown adapter exits 3", badAdapter.status === 3, `exit=${badAdapter.status}`);

  const badRuns = cli([
    "verify",
    "--skill",
    "fixtures/valid-skill",
    "--cases",
    "fixtures/evals.yaml",
    "--runs",
    "zero",
  ]);
  check("invalid --runs exits 2", badRuns.status === 2, `exit=${badRuns.status}`);

  const replay = cli(["replay", "out/replays/case-001-run-01.json", "--quiet"]);
  check("replay inspects an artifact", replay.status === 0, `exit=${replay.status} ${replay.stderr}`);

  const report = cli([
    "report",
    "--input",
    "out/summary.json",
    "--format",
    "html",
    "--output",
    "converted.html",
  ]);
  check(
    "report converts summary.json to HTML",
    report.status === 0 && existsSync(join(work, "converted.html")),
    `exit=${report.status} ${report.stderr}`,
  );
} finally {
  rmSync(work, { recursive: true, force: true });
}

if (failures.length > 0) {
  console.error(`\nSmoke test FAILED: ${failures.length} failure(s), ${passed} passed.`);
  process.exit(1);
}
console.log(`\nSmoke test passed: ${passed} checks.`);
