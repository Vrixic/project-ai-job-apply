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
2.0 Lambda entrypoint. The Lambda path accepts identity only from the exact validated authorizer
context. The protected API Gateway route requires at least one exact platform scope, and Lambda
retains route-specific `profile:read` or `profile:write` enforcement. When API Gateway's
string-only claims map flattens a multi-valued audience, the boundary
recovers the exact audience array from the same API Gateway-validated bearer token and binds it to
the trusted context through exact issuer and subject equality; the caller token is never forwarded
into the application. The entrypoint keeps the principal invocation-local, allows only the
versioned method/path inventory, rejects
unsupported query/body/media shapes, and enforces a 64 KiB decoded-body ceiling before framework
dispatch. It retrieves the database URL through the AWS Parameters and Secrets extension and caps
each warm environment at two PostgreSQL connections. All application problem responses are
non-cacheable. The existing server entrypoint remains only for the bounded migration rollback
window.

Run `pnpm --filter @ai-job-apply/gateway build:lambda` to produce the ignored deterministic ZIP,
manifest, SHA-256, and CycloneDX SBOM under `dist/lambda/`. A local artifact is build evidence, not
a published or deployed release.
