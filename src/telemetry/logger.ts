/**
 * Structured JSONL logger.
 *
 * Events are accumulated in memory and flushed once at the end of an eval run to
 * `reports/<output>/structured-events.jsonl`. Child loggers bind common fields
 * (run id, skill, model, ...) so individual `log()` calls stay terse.
 */

export type LogFields = Record<string, unknown>;

export interface LogEvent extends LogFields {
  timestamp: string;
  event: string;
}

/** Shared, append-only buffer behind a logger tree. */
class LogSink {
  readonly events: LogEvent[] = [];
}

export class StructuredLogger {
  private constructor(
    private readonly sink: LogSink,
    private readonly base: LogFields,
  ) {}

  /** Create a fresh logger tree with optional base fields. */
  static create(base: LogFields = {}): StructuredLogger {
    return new StructuredLogger(new LogSink(), base);
  }

  /** Derive a logger that adds/overrides base fields but shares the buffer. */
  child(fields: LogFields): StructuredLogger {
    return new StructuredLogger(this.sink, { ...this.base, ...fields });
  }

  /** Record one structured event. */
  log(event: string, extra: LogFields = {}): void {
    this.sink.events.push({
      timestamp: new Date().toISOString(),
      event,
      ...this.base,
      ...extra,
    });
  }

  /** All events recorded across the logger tree, in insertion order. */
  events(): LogEvent[] {
    return this.sink.events;
  }

  /** Serialize the buffer to newline-delimited JSON. */
  toJsonl(): string {
    if (this.sink.events.length === 0) return "";
    return this.sink.events.map((e) => JSON.stringify(e)).join("\n") + "\n";
  }
}
