# API Gateway and BFF

The gateway is the authenticated entry point for web, mobile, extension, and admin clients. It enforces authorization, rate limits, API versioning, request validation, idempotency, and client-specific response composition.

## Planned subfolders

- `routes/` — Versioned public and internal endpoints.
- `bff/` — Web, mobile, extension, and admin response composition.
- `middleware/` — Authentication, authorization, rate limiting, and tracing.
- `clients/` — Typed clients for domain services.
- `schemas/` — Runtime request/response validation.
- `tests/` — Contract, authorization, rate-limit, and integration tests.

The gateway must not perform long-running AI, ingestion, or browser work. It creates durable resources and returns their identifiers.

## Phase 0 implementation

`src/` provides health/readiness, current-user, job-preference, and owned-operation endpoints.
Requests use strict OpenAPI validation, scoped bearer authorization, idempotency, trace
correlation, and structured problem responses.

The managed verifier accepts only RS256 tokens from the exact configured issuer and stable
`ai-job-apply-api` audience. It resolves the issuer and subject through profile-owned identity
mapping; Auth0 identifiers do not cross into public or domain identifiers.

The scale-to-zero migration adds a shared application factory and an API Gateway HTTP API payload
2.0 Lambda entrypoint. The Lambda path accepts identity only from exact validated authorizer claims,
keeps the principal invocation-local, retrieves the database URL through the AWS Parameters and
Secrets extension, and caps each warm environment at two PostgreSQL connections. The existing
server entrypoint remains only for the bounded migration rollback window.

Run `pnpm --filter @ai-job-apply/gateway build:lambda` to produce the ignored deterministic ZIP,
manifest, SHA-256, and CycloneDX SBOM under `dist/lambda/`. A local artifact is build evidence, not
a published or deployed release.
