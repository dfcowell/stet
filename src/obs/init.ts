import { log } from "./log.js";

// Optionally register an OpenTelemetry SDK so spans are exported. By default no
// exporter is registered (spans are no-ops and the terminal shows only the
// readable leveled logs). Set OTEL_TRACES_EXPORTER=console to also print spans.
export async function initObservability(): Promise<void> {
  const exporter = process.env.OTEL_TRACES_EXPORTER ?? "off";
  log.info("observability ready", { logLevel: log.level, otelTraces: exporter });
  if (exporter !== "console") return;
  try {
    const { NodeTracerProvider } = await import("@opentelemetry/sdk-trace-node");
    const { ConsoleSpanExporter, SimpleSpanProcessor } = await import("@opentelemetry/sdk-trace-base");
    const provider = new NodeTracerProvider({
      spanProcessors: [new SimpleSpanProcessor(new ConsoleSpanExporter())],
    });
    provider.register();
    log.info("otel console span exporter enabled");
  } catch (err) {
    log.warn("otel init failed; spans remain no-ops", {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
