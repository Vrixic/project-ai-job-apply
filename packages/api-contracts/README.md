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

The in-progress D3-017 contract adds explicit cover-letter opt-in to Prepare. Omitted opt-in
retains the synchronous `201 Application`; opt-in defines a `202 ApplicationPacketPreparation`
with an owner-scoped poll route, plus immutable cover-letter preview and PDF/DOCX file reads.
Successful preparation returns an immutable `{packetId, revision}` reference, not a snapshot
of the application's mutable current state. Read the application separately for its current
packet/action. This in-progress shape has no deployed consumers.
Acknowledgement requires the exact `openai-cover-letter.v1` notice and `true`, without
caller-supplied approval time or provider/model selection. The notice text/version are exported
for consumers; generation remains separately default-off and every draft requires review.
These contracts are not deployment evidence: local persistence, durable factories and Gateway
handlers have tests, but production dispatch/recovery and isolated provider/read composition
remain unfinished. Do not activate clients against the new routes yet.

The owner-only `GET /profile/restricted-answers` metadata includes database-generated `createdAt`,
preserving the timestamp representation and precision used by candidate exports. Creation time
belongs to the answer identity and does not change when a version is corrected or deleted. It is
optional in the shared v1 `RestrictedAnswer` schema to support legacy lists and unchanged save
responses. No response exposes an answer value or ciphertext, and existing scopes and routes are
unchanged. Deploy the compatible Gateway/Profile implementation before requiring this field in
an acceptance harness; schema generation alone is not deployment evidence.
Rebuild and deploy strict response-validating consumers with the updated contract **before** the
Gateway starts returning this field: older closed-object validators reject new response keys.
Optionality permits new readers to accept old lists/save responses; it does not make old strict
readers accept the new property. This change includes no frontend source edit or hosted deployment.

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

The additive D2-066 `GET /jobs/contributions` recovers recent owner history without requiring a
locally retained contribution identifier. It accepts no body or query and uses `jobs:contribute`.
`JobContributionHistory` contains only `items`, with at most 25 existing `JobContribution`
summaries in descending submitted-time/identifier order. Responses are `no-store`, account-owned,
and contain no posting text or contributor/reviewer identities. Existing single-item/create
contracts are unchanged; rollout requires the new exact authenticated route and compatible Gateway.

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

Packet preparation accepts optional bounded explicit `vaultSelections`; a selection requires
`form`, exact revision/context, observed question hash and candidate meaning confirmation.
Optional packet-field `vaultReference` requires answer-vault origin and mandatory review.
Old strict readers must be deployed with these shapes before producers are enabled; legacy
requests and packet hashes remain unchanged. The existing stale problem code adds the closed
`vault_answer_changed` reason without returning private metadata in failure details.
