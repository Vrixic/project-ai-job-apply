# OpenAPI Sources

Versioned REST API source documents. These files are reviewed before implementation changes and
drive generated transport types and clients.

`GET /extension/contribution-capability-policy` is an explicitly anonymous, bodyless, queryless,
`no-store` read of the exact signed policy envelope used to gate browser-extension contribution
intake and processing. Its response excludes pinned verification keys and all signing secrets;
runtime absence, invalidity, or staleness is a fixed availability failure. The OpenAPI path does
not activate the deployed Lambda route, which remains default-dark behind a separate boundary.

`GET /public/jobs/{jobId}` is an explicitly anonymous, read-only boundary. It accepts only an exact
lowercase UUIDv7 path and returns the Jobs-owned bounded public projection: reversible
requested/canonical identity, display text, and freshness/expiry timestamps. Source URLs,
providers, provenance, company internals, lifecycle reasons, candidate state, and raw source artifacts are
not part of this contract. Generic `404` covers every unavailable target, while dependency or
malformed-record failures remain `503` so an outage cannot be mistaken for removal. The response
is revalidation-only at the HTTP edge; a separately bounded warm-process cache is an implementation
detail, not a stale-on-error promise.
Lambda-owned `400`, `404`, and `503` responses freeze their exact cache and problem-details
headers. API Gateway may independently reject excess traffic with its managed edge `429`
transport; that infrastructure response is intentionally not represented as an application-owned
ProblemDetails contract.

The saved-job paths separate `jobs:read` list access from `jobs:write` mutation access, never accept
an owner identifier, and return only bounded public snapshots plus `available` or `unavailable`.
The unavailable state intentionally carries no internal lifecycle reason. Saved-job responses,
including idempotent deletion, are private and declare `Cache-Control: no-store`.

`GET /jobs/{jobId}/match-assessment` is an owner-self, bodyless, queryless read under the existing
`jobs:read` permission. It returns exactly nine ordered, fixed-code constraint evidence entries,
binds requested/canonical job identity plus preference and catalog versions, and is always
`no-store`. Only exact known work-mode or employment-type contradictions can produce `excluded`;
unknown evidence cannot. The contract contains no candidate values, job display values, score,
rank, fit band, generated prose, eligibility, or application outcome.

`POST /jobs/{jobId}/reports` is an authenticated `jobs:write` command with no owner field. It
accepts one fixed reason enum and an idempotency key, resolves exact aliases to a canonical active
job, and returns only opaque report and job identifiers, the reason code, and creation time. Free
text, reporter identity, moderation state, source identity, and lifecycle reasons are excluded.
Reports do not directly block, withdraw, pause, or otherwise mutate a job or source.

The `/admin/moderation` routes require the separate `jobs:moderate` scope. Their strict fixed-code
contracts expose aggregate report counts and redacted case state only, use signed opaque
continuation cursors, and never accept or return an operator identity. Case resolution is fenced to
version zero and records only `no_action`, `block_job`, or `pause_source`; target/action consistency
is enforced by the gateway and Jobs owner.

`GET /entitlements` is an owner-self read under the existing `profile:read` permission. It accepts
no query, body, path owner, provider, or payment input and returns only the exact derived Free or
Pro access projection with the four current core grants. Free, active Pro, and grace Pro are
separate strict response shapes; every response is private and non-cacheable.
