import { randomBytes } from "node:crypto";

/**
 * Identifier helpers.
 *
 * Run ids are human-scannable; trace/span ids follow the OpenTelemetry wire
 * format (16-byte trace id, 8-byte span id, lowercase hex) so the demo
 * telemetry can be swapped for a real OTEL exporter later without reshaping ids.
 */

let runCounter = 0;

function hex(bytes: number): string {
  return randomBytes(bytes).toString("hex");
}

/** Short, unique, greppable run id, e.g. `run_lr9f3a_0007`. */
export function newRunId(): string {
  const seq = (runCounter++).toString().padStart(4, "0");
  return `run_${hex(3)}_${seq}`;
}

/** 128-bit trace id as 32 lowercase hex chars (OTEL format). */
export function newTraceId(): string {
  return hex(16);
}

/** 64-bit span id as 16 lowercase hex chars (OTEL format). */
export function newSpanId(): string {
  return hex(8);
}
