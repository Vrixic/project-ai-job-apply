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

The additive Phase 2 private-capture contract defines strict owner-scoped
`POST /saved-job-captures` and `GET`/`DELETE /saved-job-captures/{captureId}` routes. The create
command binds one client UUIDv7 and `Idempotency-Key` to the exact sanitized provider source,
bounded snapshot, and capture time. Responses omit the owner and internal verification-evidence
identifiers. No public resolution-write route exists, and this private command has no contribution
consent or catalog-publication meaning.

The additive Phase 2 contribution contract defines strict `POST /jobs/contributions` and owner
`GET /jobs/contributions/{contributionId}` routes under the exact `jobs:contribute` scope. Intake
requires a client-generated UUIDv7, `Idempotency-Key`, detector identity, exact installed browser
extension surface/version, selected public fields, and immutable Profile consent/digest references.
Both canonical content and preview digests bind that exact client surface/version. Owner status
uses the fixed public-safe processing-state enum and still excludes reasons, evidence, internal
identifiers, and reviewer data; a state does not itself claim canonical publication truth.

The anonymous `GET /extension/contribution-capability-policy` contract returns one exact bounded
signed envelope for extension fail-closed gating. It is explicitly `no-store`, contains no signing
secret or pinned public-key material, and declares a fixed `503` availability boundary. Client
version keys use the same bounded exact version grammar as contribution intake. Runtime exposure
is separately activation-controlled; the contract alone does not enable the deployed route.

The additive Trust contract uses the owner-known contribution UUID for private status, withdrawal,
and one evidence-digest appeal. Reviewer routes require explicit read/open/decision/takedown/appeal
scopes and expose only fixed-code, identity-redacted case projections. Trust case identifiers allow
server-derived UUIDv8 values; contribution identifiers remain UUIDv7. All responses are `no-store`,
and no contract accepts raw evidence or caller-supplied contributor/reviewer identity.

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
