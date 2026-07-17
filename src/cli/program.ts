import { Command, CommanderError } from "commander";
import { errorMessage, exitCodeForError, VerifierError } from "../core/errors.js";
import { setWorkspaceRoot } from "../core/paths.js";
import { TOOL_NAME, toolVersion } from "../core/version.js";
import { processIo, type CliIo } from "./io.js";
import { runReplayCommand } from "./commands/replay.js";
import { runReportCommand } from "./commands/report.js";
import { runValidateCommand } from "./commands/validate.js";
import { runVerifyCommand, type VerifyCliOptions } from "./commands/verify.js";

/**
 * CLI wiring for `agent-skill-verifier`.
 *
 * `runCli` is fully in-process (no process.exit, injectable output) so the
 * entire command surface is unit-testable and the exit-code contract can be
 * asserted directly:
 *
 *   0 success | 1 gate failed | 2 invalid input | 3 adapter unavailable
 *   4 runtime failure | 5 timeout/cancelled | 6 report/artifact failure
 */

function stripTrailingNewline(text: string): string {
  return text.endsWith("\n") ? text.slice(0, -1) : text;
}

function buildProgram(io: CliIo, state: { exitCode: number }): Command {
  const program = new Command();
  program
    .name(TOOL_NAME)
    .description(
      "Verify AI agent skills through repeatable eval runs, replayable artifacts,\n" +
        "structured reports, and CI-friendly exit codes.",
    )
    .version(toolVersion(), "-V, --version", "print the tool version")
    .exitOverride()
    .configureOutput({
      writeOut: (s) => io.out(stripTrailingNewline(s)),
      writeErr: (s) => io.err(stripTrailingNewline(s)),
    });

  const verify = program
    .command("verify")
    .description("run the evaluation suite against a skill and write the report bundle")
    .option("--skill <path>", "path to the skill directory (contains skill-contract.json)")
    .option("--cases <path>", "path to the evaluation cases file (JSON or YAML)")
    .option("--config <path>", "path to a skill-verification.(yaml|yml|json) configuration file")
    .option("--adapter <name>", "model adapter to evaluate with (default: mock)")
    .option("--runs <n>", "runs per case (positive integer, default: 10)")
    .option("--threshold <n>", "pass-rate threshold between 0 and 1 (default: 0.9)")
    .option("--seed <n>", "integer seed for deterministic mock-adapter runs")
    .option("--timeout-ms <ms>", "overall wall-clock budget for all runs")
    .option("--output <dir>", "output directory (default: .agent-skill-verification)")
    .option("--format <format>", "result presentation: terminal | json")
    .option("--json", "shorthand for --format json (plain JSON, no ANSI codes)")
    .option("--fail-on-threshold", "exit 1 when the quality gate fails (default)")
    .option("--no-fail-on-threshold", "always exit 0 when verification completes")
    .option("--non-interactive", "never prompt (the CLI is always non-interactive; accepted for CI clarity)")
    .option("--verbose", "print resolved options before running")
    .option("--quiet", "print only the one-line result")
    .action(async (opts: VerifyCliOptions, cmd: Command) => {
      const failOnThresholdSource = cmd.getOptionValueSource("failOnThreshold");
      const effective: VerifyCliOptions = {
        ...opts,
        failOnThreshold:
          failOnThresholdSource === "cli" ? (opts.failOnThreshold as boolean) : undefined,
      };
      state.exitCode = await runVerifyCommand(io, effective);
    });
  verify.addHelpText(
    "after",
    "\nPaths are resolved relative to the current working directory.\n" +
      "Precedence: CLI flags > configuration file > built-in defaults.",
  );

  program
    .command("validate")
    .description("statically validate a skill, its evaluation cases, and configuration (no runs)")
    .option("--skill <path>", "path to the skill directory")
    .option("--cases <path>", "path to the evaluation cases file (JSON or YAML)")
    .option("--config <path>", "path to a configuration file")
    .option("--adapter <name>", "adapter name to check")
    .option("--runs <n>", "runs value to check")
    .option("--threshold <n>", "threshold value to check")
    .option("--output <dir>", "output directory to check")
    .option("--json", "print the validation report as JSON")
    .option("--quiet", "suppress informational output")
    .action((opts) => {
      state.exitCode = runValidateCommand(io, opts);
    });

  program
    .command("replay")
    .description("inspect a stored replay artifact (no model call; the artifact is never modified)")
    .argument("<artifact>", "path to a replay artifact JSON file")
    .option("--json", "print the validated artifact as JSON")
    .option("--quiet", "print only the run header and verdict")
    .action((artifact: string, opts) => {
      state.exitCode = runReplayCommand(io, artifact, opts);
    });

  program
    .command("report")
    .description("convert a canonical summary.json into terminal, json, junit, or html output")
    .option("--input <path>", "path to a canonical summary.json")
    .option("--format <format>", "terminal | json | junit | html (default: terminal)")
    .option("--output <path>", "file to write (default: print to stdout)")
    .option("--json", "shorthand for --format json")
    .action((opts) => {
      state.exitCode = runReportCommand(io, opts);
    });

  return program;
}

function wantsJsonOutput(argv: string[]): boolean {
  const formatIdx = argv.indexOf("--format");
  return argv.includes("--json") || (formatIdx !== -1 && argv[formatIdx + 1] === "json");
}

export async function runCli(argv: string[], io: CliIo = processIo): Promise<number> {
  setWorkspaceRoot(process.cwd());
  const state = { exitCode: 0 };
  const program = buildProgram(io, state);

  try {
    if (argv.length === 0) {
      io.out(program.helpInformation());
      return 0;
    }
    await program.parseAsync(argv, { from: "user" });
    return state.exitCode;
  } catch (error) {
    if (error instanceof CommanderError) {
      // Help/version are informational successes; every other parse problem is
      // invalid CLI input.
      if (
        error.code === "commander.helpDisplayed" ||
        error.code === "commander.help" ||
        error.code === "commander.version"
      ) {
        return 0;
      }
      return 2;
    }

    const code = exitCodeForError(error);
    const kind = error instanceof VerifierError ? error.kind : "runtime-failure";
    if (wantsJsonOutput(argv)) {
      io.out(
        JSON.stringify(
          {
            tool: { name: TOOL_NAME, version: toolVersion() },
            error: { kind, exitCode: code, message: errorMessage(error) },
          },
          null,
          2,
        ),
      );
    } else {
      io.err(`Error: ${errorMessage(error)}`);
    }
    return code;
  }
}
