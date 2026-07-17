/**
 * CLI I/O abstraction. Commands never call console/process directly; they
 * write through this interface so tests can capture output in-process and so
 * JSON mode is guaranteed free of ANSI escape codes.
 */

export interface CliIo {
  out(text: string): void;
  err(text: string): void;
}

export const processIo: CliIo = {
  out(text: string): void {
    process.stdout.write(`${text}\n`);
  },
  err(text: string): void {
    process.stderr.write(`${text}\n`);
  },
};

export interface ColorOptions {
  json: boolean;
  quiet: boolean;
}

/**
 * Color is enabled only for interactive terminals, and never in JSON mode.
 * `NO_COLOR` (https://no-color.org) and CI environments disable it.
 */
export function colorEnabled(opts: { json?: boolean } = {}): boolean {
  if (opts.json) return false;
  if (process.env.NO_COLOR !== undefined && process.env.NO_COLOR !== "") return false;
  if (process.env.CI === "true") return false;
  return Boolean(process.stdout.isTTY);
}

const ESC = String.fromCharCode(27);

export function paint(enabled: boolean, code: string, text: string): string {
  return enabled ? `${ESC}[${code}m${text}${ESC}[0m` : text;
}

export const green = (enabled: boolean, text: string): string => paint(enabled, "32", text);
export const red = (enabled: boolean, text: string): string => paint(enabled, "31", text);
export const yellow = (enabled: boolean, text: string): string => paint(enabled, "33", text);
export const bold = (enabled: boolean, text: string): string => paint(enabled, "1", text);
export const dim = (enabled: boolean, text: string): string => paint(enabled, "2", text);
