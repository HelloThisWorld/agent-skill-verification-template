#!/usr/bin/env node
import { processIo } from "./io.js";
import { runCli } from "./program.js";

/**
 * Executable entry point for `agent-skill-verifier`. Kept to a thin shell so
 * every behavior (including exit codes) lives in testable modules.
 */

const CANCELLED_EXIT = 5;

process.once("SIGINT", () => {
  processIo.err("Cancelled.");
  process.exit(CANCELLED_EXIT);
});
process.once("SIGTERM", () => {
  processIo.err("Cancelled.");
  process.exit(CANCELLED_EXIT);
});

runCli(process.argv.slice(2), processIo)
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error) => {
    processIo.err(`Fatal: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`);
    process.exitCode = 4;
  });
