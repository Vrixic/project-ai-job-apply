# Observability Source

Creates structured service loggers, initializes the OpenTelemetry Node SDK before application
composition, and continues validated W3C context across durable boundaries. Logging centrally
redacts credentials, candidate contact information, preferences, and resume content; tracing never
adds request headers, bodies, candidate fields, or raw artifacts.

The package also owns the fixed, privacy-safe log-delivery heartbeat used by always-on services.
The heartbeat contains only its constant event name plus the logger's service/release base fields,
emits immediately and every 30 seconds, and returns a shutdown function for deterministic cleanup.
