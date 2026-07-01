import type { SpanRecord } from "../core/types.js";
import { newSpanId } from "../core/run-id.js";

/**
 * Minimal, OpenTelemetry-shaped tracer.
 *
 * This is DEMO telemetry: spans are captured as plain objects (see
 * `SpanRecord`) using the OTEL trace/span id format and a parent/child stack.
 * It does NOT export to a real collector — that is a roadmap item documented in
 * docs/observability-model.md. The shape is deliberately close to OTEL so a real
 * exporter can be dropped in without changing call sites.
 */
export class Span {
  private ended = false;

  constructor(
    private readonly record: SpanRecord,
    private readonly tracer: Tracer,
  ) {}

  setAttribute(key: string, value: unknown): this {
    this.record.attributes[key] = value;
    return this;
  }

  addEvent(name: string, attributes?: Record<string, unknown>): this {
    this.record.events.push({ name, timeMs: Date.now(), attributes });
    return this;
  }

  end(status: "ok" | "error" = "ok"): void {
    if (this.ended) return;
    this.ended = true;
    this.record.endTimeMs = Date.now();
    this.record.durationMs = this.record.endTimeMs - this.record.startTimeMs;
    this.record.status = status;
    this.tracer.closeSpan(this.record.spanId);
  }
}

export class Tracer {
  private readonly spans: SpanRecord[] = [];
  private readonly stack: string[] = [];

  constructor(public readonly traceId: string) {}

  startSpan(name: string, attributes: Record<string, unknown> = {}): Span {
    const spanId = newSpanId();
    const parentSpanId = this.stack.length ? this.stack[this.stack.length - 1] : undefined;
    const now = Date.now();
    const record: SpanRecord = {
      name,
      traceId: this.traceId,
      spanId,
      parentSpanId,
      startTimeMs: now,
      endTimeMs: now,
      durationMs: 0,
      status: "ok",
      attributes: { ...attributes },
      events: [],
    };
    this.spans.push(record);
    this.stack.push(spanId);
    return new Span(record, this);
  }

  /** Run a function inside a span, ending it automatically (even on throw). */
  async withSpan<T>(
    name: string,
    attributes: Record<string, unknown>,
    fn: (span: Span) => Promise<T> | T,
  ): Promise<T> {
    const span = this.startSpan(name, attributes);
    try {
      const result = await fn(span);
      span.end("ok");
      return result;
    } catch (error) {
      span.addEvent("exception", { message: error instanceof Error ? error.message : String(error) });
      span.end("error");
      throw error;
    }
  }

  /** Internal: called by Span.end to unwind the parent stack. */
  closeSpan(spanId: string): void {
    const idx = this.stack.lastIndexOf(spanId);
    if (idx >= 0) this.stack.splice(idx, 1);
  }

  getSpans(): SpanRecord[] {
    return this.spans;
  }
}
