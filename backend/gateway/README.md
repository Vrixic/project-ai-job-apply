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

The source-only Phase 2 seam exposes Profile-owned immutable contribution-consent grant/revoke
routes in local application composition and wires Jobs intake to the real Profile verification
store. Consent identifiers and times are server-issued, responses are `no-store`, and both routes
require `jobs:contribute`. An exact `UGC_CONTRIBUTION_POLICY_VERSION` must be injected; absence or
mismatch fails closed. The Lambda method/path allowlist intentionally omits consent and
contribution routes, so deployed intake remains default-dark.

## Phase 0 implementation

`src/` provides health/readiness, current-user, job-preference, and owned-operation endpoints.
Requests use strict OpenAPI validation, scoped bearer authorization, idempotency, trace
correlation, and structured problem responses.

The managed verifier accepts only RS256 tokens from the exact configured issuer and stable
`ai-job-apply-api` audience. It resolves the issuer and subject through profile-owned identity
mapping; Auth0 identifiers do not cross into public or domain identifiers.

The D1 catalog read path requires the dedicated `jobs:read` scope and exposes only active,
unexpired canonical detail plus redacted source summaries. Raw snapshots, source identity keys,
hashes, pending/suspect records, and terminal tombstones never cross the candidate API boundary.
Because this catalog is shared rather than candidate-owned, the route verifies the managed OIDC
principal and exact scope without creating or updating a profile identity record. Owner-scoped
profile and operation routes continue resolving the provider identity to an internal user UUID.

`POST /v1/jobs/search` uses the same exact `jobs:read` boundary. Its strict, size-bounded JSON body
keeps query and filter values out of URLs, and the Lambda route continues rejecting every raw query
string before framework dispatch. The gateway returns only active canonical summaries and an
opaque continuation cursor; it does not log, audit, or emit search values and does not perform
profile matching.

Private saved jobs use `jobs:read` for owner-scoped pages and the distinct `jobs:write` permission
for create/delete commands. Create accepts only an active public job target, returns one generic
unavailable error for unknown or non-active targets, and stores both the requested target and the
canonical identifier resolved at save time. Delete is idempotent and returns the same `204` for an
unknown identifier or another owner's identifier. Saved snapshots remain visible when a posting
leaves the active catalog without exposing internal lifecycle reasons. Scoring and generated
explanations are not part of these routes.

The exact bodyless and queryless `GET /v1/jobs/{jobId}/match-assessment` route reuses `jobs:read`,
resolves the OIDC principal through Profile to one internal owner UUID, and supplies that UUID only
to Matching. Matching reads the owner preference snapshot and a Jobs-owned active canonical
projection; the gateway validates the complete fixed-code response before returning it with
`Cache-Control: no-store`. Missing preferences or legacy restricted sponsorship fields require
candidate review, unavailable targets return generic absence, and malformed/dependency failures
return a generic `503` without reflecting profile, job, or database values.

`POST /v1/jobs/{jobId}/reports` requires `jobs:write`, resolves the managed OIDC principal through
Profile to one internal UUID, rejects query parameters and unknown body fields, and passes only
that UUID, the requested lowercase UUIDv7, one fixed reason code, and a bounded idempotency key to
Jobs. The response is `no-store`; target absence and duplicate/idempotency outcomes expose no
catalog lifecycle or owner details.

The locally implemented admin boundary adds exact `jobs:moderate` routes for aggregate candidate
report counts, signed keyset case pages, explicit case opening, and version-fenced resolution. It
derives a stable opaque audit identifier from the validated issuer and subject without persisting
or returning either raw identity-provider value. Candidate scopes cannot enter these routes, and
responses omit operator identities. Job blocking and exact-source pausing remain deliberate human
actions; reports never invoke either action automatically and no source-resume route exists.

This is locally verified source only. The saved-job mutation permission/grant, publication,
database migration, deployment, and live acceptance remain serialized later gates; do not release
the mutation surface until the managed client has the exact `jobs:write` grant. The assessment read
adds no Auth0 scope or Terraform route because the protected `$default` route already delegates to
the Lambda method/path allowlist, but its new source and migration still require immutable release
and managed-OIDC/browser acceptance.

The provider-neutral entitlement read uses exact `profile:read` and accepts no owner identifier,
query, or body. Profile resolves the validated issuer and subject to one internal UUID before the
gateway calls Billing with only that UUID and one server clock instant. The response contains only
the derived plan, active/grace state, exact current grants, version, evaluation time, and applicable
access boundaries. Invalid schedules, owner mismatches, and unavailable Billing reads collapse to
one generic `503`; private responses are `no-store`. One bounded owner-keyed cache is shared per
warm process, and readiness verifies the exact Billing schema boundary. Because Profile identity
resolution happens before Billing evaluation, cached Pro grace does not claim availability through
a total identity/database outage.

The route, Billing migration-image composition, BFF, and read-only UI are source behavior only.
No Auth0/Terraform route change, image publication, AWS deployment, provider/payment flow, price,
quota, upgrade, paid-only feature, webhook, or live acceptance is included.

## D1 local API assurance

`pnpm --filter @ai-job-apply/gateway test:assurance` runs a bounded mixed-workload baseline through
the real in-process Fastify application. It uses only fixed synthetic identities, catalog data,
requests, and fault canaries. The matrix exercises liveness/readiness, two concurrent candidate
owners, job search, job reporting, authentication/scope/input rejection, dependency-failure
sanitization and isolation, and recovery. Its receipt retains aggregate counts only: request,
expected-status, contract-failure, privacy-leak, transport-failure, and maximum in-flight totals.
It never retains request bodies, response bodies, tokens, owner identifiers, or fault details.

The configured concurrency is a deterministic harness bound, not a throughput target. This local
in-process test does not establish latency, capacity, API Gateway or Lambda throttling, WAF/abuse
controls, database behavior, alert delivery, deployment, RTO/RPO, independent security review, or
human accessibility acceptance. Those require the exact deployed D1 candidate and separately
authorized evidence.

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

The source-only public-job reader uses a separate raw Lambda entrypoint and accepts only exact
bodyless, queryless `GET /v1/public/jobs/{lowercase-uuidv7}` requests. It projects the Jobs-owned
public allowlist, preserves reversible alias identity, uses bounded warm-process positive/negative
LRU caching without stale-on-error, and emits generic absence or availability problems. It has no
OIDC, candidate, saved-job, source URL, or mutation boundary. Its PostgreSQL client uses one
connection, refreshed RDS IAM tokens, verified-host TLS, and the exact
`ai_job_apply_public_job_reader` identity; it never receives the shared application database
secret. The Lambda and route remain Terraform-default-off. The Jobs migration and local direct-SQL
refusals are source-verified but unapplied. Reviewed bootstrap/migration apply, artifact publication,
Terraform plan/apply, accountable cluster-residual acceptance, and live abuse/availability
acceptance are mandatory before anonymous activation.

That isolated public edge/projection pair also implements the strict
`GET /v1/public/jobs/sitemap` feed. The private Lambda accepts only an exact versioned sitemap
operation and calls the Jobs-owned fixed projection; the edge validates every item and continuation
before returning a bounded page. Invalid dependency payloads and invocation failures return one
generic `503` and are never represented as an empty successful feed. The sitemap route shares the
public-detail activation expression, so Terraform defaults leave both anonymous routes absent.
