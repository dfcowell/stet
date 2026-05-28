import { trace, SpanStatusCode, type Span, type AttributeValue } from "@opentelemetry/api";
import { log } from "./log.js";

export const tracer = trace.getTracer("stet");

type Attrs = Record<string, AttributeValue>;

// Runs `fn` inside an OpenTelemetry span and emits readable debug/error logs
// around it. Without a registered SDK the span is a no-op, but the logs still
// fire — so the terminal stays useful regardless of exporter configuration.
export async function withSpan<T>(
  name: string,
  fn: (span: Span) => Promise<T>,
  attrs: Attrs = {},
): Promise<T> {
  return tracer.startActiveSpan(name, async (span) => {
    span.setAttributes(attrs);
    const startedAt = Date.now();
    log.debug(`▶ ${name}`, attrs);
    try {
      const result = await fn(span);
      span.setStatus({ code: SpanStatusCode.OK });
      log.debug(`✔ ${name}`, { ms: Date.now() - startedAt });
      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      span.recordException(err as Error);
      span.setStatus({ code: SpanStatusCode.ERROR, message });
      log.error(`✖ ${name}`, { ms: Date.now() - startedAt, error: message });
      throw err;
    } finally {
      span.end();
    }
  });
}
