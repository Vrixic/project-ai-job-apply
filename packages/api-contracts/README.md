# API Contracts

Defines versioned API schemas and generates type-safe clients for web, mobile, extension, admin, gateway, and services.

## Planned subfolders

- `openapi/` — REST/OpenAPI source documents.
- `graphql/` — GraphQL schemas if adopted.
- `json-schema/` — Shared request/response structures.
- `generated/` — Generated clients and types; never hand-edited.
- `compatibility/` — Breaking-change and backward-compatibility checks.
- `tests/` — Schema examples and consumer contract tests.

Contracts contain transport shapes, not backend implementation or persistence models.

The additive Phase 2 contribution contract defines strict `POST /jobs/contributions` and owner
`GET /jobs/contributions/{contributionId}` routes under the exact `jobs:contribute` scope. Intake
requires a client-generated UUIDv7, `Idempotency-Key`, detector identity, selected public fields,
and immutable Profile consent/digest references. Its only response state is `queued`; the contract
does not claim verification, moderation, canonical-job creation, or publication.

The same additive version defines Profile-owned `POST /profile/ugc-contribution-consents` and
owner-scoped revoke routes. The client supplies only the canonical preview digest plus technical
document and externally selected policy versions; it cannot supply a consent identifier or grant
time. Success returns the server-issued identifier and exact server time under `no-store`. The
policy value is deliberately pattern-constrained rather than selected by source code.

The D1 catalog contract defines a strict `POST /v1/jobs/search` body with bounded supported filters,
an exact `jobs:read` security requirement, active redacted result summaries, and an opaque
continuation cursor. It intentionally excludes saved-job state, profile matching, and unsupported
inferred filters.

The anonymous public-job contract also defines an additive, strict
`GET /v1/public/jobs/sitemap` feed. It returns at most 100 canonical UUIDv7 identifiers with one
public freshness timestamp and an optional opaque keyset cursor. The feed contains no job text,
source/provenance data, candidate data, or internal lifecycle state; dependency failures are
availability errors rather than successful empty pages.
