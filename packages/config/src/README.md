# Configuration Source

Validates service and worker environment variables at startup. Missing identity or durable-service
configuration causes startup to fail rather than silently reducing protection.

Redis is optional until a bounded cache, distributed rate-limit, or lease use case is implemented;
it is never a durable source of truth.
