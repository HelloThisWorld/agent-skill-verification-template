import type { LogFields } from "./logger.js";
import { StructuredLogger } from "./logger.js";
import { Tracer } from "./tracing.js";

/**
 * The telemetry handed to a single skill run: a per-run tracer plus a child
 * logger with the run's identity fields already bound.
 */
export interface TelemetryContext {
  logger: StructuredLogger;
  tracer: Tracer;
}

/**
 * Build a per-run telemetry context from the eval-wide root logger. The tracer
 * is scoped to a single trace id (one trace per run).
 */
export function createRunTelemetry(
  rootLogger: StructuredLogger,
  traceId: string,
  fields: LogFields,
): TelemetryContext {
  return {
    logger: rootLogger.child(fields),
    tracer: new Tracer(traceId),
  };
}
