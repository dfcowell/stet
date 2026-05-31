import { log } from "./log.js";

// Registers an OpenTelemetry SDK so spans are exported. By default no exporter
// is registered (spans are no-ops and the terminal shows only the readable
// leveled logs).
//
//   OTEL_TRACES_EXPORTER=console  → print spans to stderr
//   OTEL_TRACES_EXPORTER=otlp     → ship via OTLP/HTTP to OTEL_EXPORTER_OTLP_ENDPOINT
//                                   (or OTEL_EXPORTER_OTLP_TRACES_ENDPOINT). Honors
//                                   OTEL_EXPORTER_OTLP_HEADERS and standard OTel
//                                   env vars; defaults to http://localhost:4318.
//   anything else                 → spans remain no-ops
export async function initObservability(): Promise<void> {
  // Default the service name so spans aren't tagged "unknown_service:node" in
  // collectors. Users can still override via env.
  if (!process.env.OTEL_SERVICE_NAME) process.env.OTEL_SERVICE_NAME = "stet";

  const exporter = process.env.OTEL_TRACES_EXPORTER ?? "off";
  log.info("observability ready", { logLevel: log.level, otelTraces: exporter });
  if (exporter !== "console" && exporter !== "otlp") return;

  try {
    const { NodeTracerProvider } = await import("@opentelemetry/sdk-trace-node");
    const { ConsoleSpanExporter, SimpleSpanProcessor, BatchSpanProcessor } = await import(
      "@opentelemetry/sdk-trace-base"
    );
    const { defaultResource, resourceFromAttributes } = await import("@opentelemetry/resources");

    let spanProcessor;
    if (exporter === "otlp") {
      const { OTLPTraceExporter } = await import("@opentelemetry/exporter-trace-otlp-http");
      // OTLPTraceExporter reads OTEL_EXPORTER_OTLP_(TRACES_)ENDPOINT and
      // OTEL_EXPORTER_OTLP_HEADERS from env. Batch processor for production
      // shipping; console keeps SimpleSpanProcessor so spans print as they end.
      spanProcessor = new BatchSpanProcessor(new OTLPTraceExporter());
    } else {
      spanProcessor = new SimpleSpanProcessor(new ConsoleSpanExporter());
    }

    // Merge the SDK's default resource (which includes telemetry.sdk.* and
    // any auto-detected attributes) with our service.name so spans aren't
    // tagged "unknown_service:node" in collectors.
    const resource = defaultResource().merge(
      resourceFromAttributes({ "service.name": process.env.OTEL_SERVICE_NAME ?? "stet" }),
    );
    const provider = new NodeTracerProvider({ resource, spanProcessors: [spanProcessor] });
    provider.register();
    log.info("otel exporter enabled", { exporter });
  } catch (err) {
    log.warn("otel init failed; spans remain no-ops", {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
