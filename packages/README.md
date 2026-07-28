# Shared Packages

This directory contains versioned libraries and contracts shared across applications and services. Packages should be small, dependency-conscious, independently testable, and free of product-service data access.

## Subfolders

- `api-contracts/` — Public/internal API schemas and generated clients.
- `event-contracts/` — Versioned asynchronous event schemas.
- `domain/` — Pure shared value objects and domain primitives.
- `validation/` — Canonical fields and deterministic validation.
- `ats-sdk/` — ATS adapter interfaces and DOM utilities.
- `ai-sdk/` — Model gateway interfaces, prompts, schemas, and safety utilities.
- `auth/` — Cross-client/service authentication helpers.
- `observability/` — Logging, metrics, traces, and correlation.
- `design-system/` — Accessible visual primitives and tokens.
- `config/` — Typed non-secret configuration.
- `test-fixtures/` — Sanitized reusable test inputs.

Packages must not become a hidden monolith or a place for circular service dependencies.
