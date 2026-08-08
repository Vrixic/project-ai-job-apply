import { initializeTelemetry, shutdownTelemetry } from "@ai-job-apply/observability";

initializeTelemetry({
  service: "local-durable-runtime",
  environment: process.env.NODE_ENV ?? "development",
  ...(process.env.OTEL_EXPORTER_OTLP_ENDPOINT
    ? { endpoint: process.env.OTEL_EXPORTER_OTLP_ENDPOINT }
    : {}),
  ...(process.env.OTEL_TRACE_SAMPLE_RATIO
    ? { sampleRatio: Number(process.env.OTEL_TRACE_SAMPLE_RATIO) }
    : {}),
  ...(process.env.RELEASE_SHA ? { releaseSha: process.env.RELEASE_SHA } : {}),
});

try {
  await import("./local-runtime.js");
} catch (error) {
  await shutdownTelemetry();
  throw error;
}
