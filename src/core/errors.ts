/**
 * Typed error hierarchy for the verifier. Every error carries the stable exit
 * code documented in the CLI contract:
 *
 *   0  success / informational command succeeded
 *   1  verification completed but the quality gate failed (not an error class)
 *   2  invalid CLI input, configuration, skill, or evaluation cases
 *   3  adapter, provider, or model unavailable
 *   4  verification runtime failure
 *   5  timeout or cancellation
 *   6  report or artifact failure
 */

export class VerifierError extends Error {
  constructor(
    message: string,
    readonly exitCode: number,
    readonly kind: string,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

/** Invalid CLI input, configuration, skill definition, or evaluation cases. Exit 2. */
export class InputError extends VerifierError {
  constructor(message: string) {
    super(message, 2, "invalid-input");
  }
}

/** The requested adapter/provider/model is unknown or unreachable. Exit 3. */
export class AdapterUnavailableError extends VerifierError {
  constructor(message: string) {
    super(message, 3, "adapter-unavailable");
  }
}

/** The verification run itself failed in an unexpected way. Exit 4. */
export class VerificationRuntimeError extends VerifierError {
  constructor(message: string) {
    super(message, 4, "runtime-failure");
  }
}

/** The run exceeded its deadline or was cancelled. Exit 5. */
export class VerificationTimeoutError extends VerifierError {
  constructor(message: string) {
    super(message, 5, "timeout");
  }
}

/** Writing or validating a report/artifact failed. Exit 6. */
export class ArtifactError extends VerifierError {
  constructor(message: string) {
    super(message, 6, "artifact-failure");
  }
}

/** Map any thrown value to the documented exit code (unknown errors are runtime failures). */
export function exitCodeForError(error: unknown): number {
  if (error instanceof VerifierError) return error.exitCode;
  return 4;
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
