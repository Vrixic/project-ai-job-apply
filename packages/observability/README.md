# Observability

Provides consistent structured logging, metrics, traces, audit correlation, redaction, and context propagation.

## Current capabilities

- Pino structured logging with central sensitive-field redaction.
- Validated request correlation identifiers.
- OpenTelemetry Node SDK startup with OTLP/protobuf export.
- W3C `traceparent` parsing, serialization, and explicit async span continuation.
- Parent-based sampling and service/release/environment resource identity.
- Node HTTP instrumentation with no configured header/body capture and no tracing of
  query-bearing requests.

Logs and traces identify workflows and versions without recording resume text, tokens, or application-field values.
