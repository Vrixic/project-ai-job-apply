# D3-079 authenticated scalar native-read authorization — 2026-10-05

## Scope and path

Candidate token → native HTTPS identity/scope check → fixed HTTPS Gateway scalar endpoint →
normal authenticated Identity resolution → owned Applications packet/reference read → strict
scalar proof → native source/packet/token revalidation → generated body in native process only.

Source begins from fetched main `e48bdf3a` plus exact expanded #555 `8edcc3df` in the isolated
backend worktree. This removes the need for a separate read credential/issuer merely to check
owner authorization. Launch admission, private model/evidence/work/completion adapters and exact
allocation registry still remain. No frontend, public hostname, deployment or activation.

## Implemented source

The additive v1 `GET /applications/{applicationId}/cover-letter/authorization?generationId=...`
uses `applications:read`, normal verified subject-to-owner resolution, strict query/path/body
validation and no-store success responses. Applications' independent flag defaults off. Older
compositions lacking the new optional capability refuse. Production bootstrap does not select
this flag. It returns only schema version, current packet ID/hash and seven original material
metadata fields. No owner ID, credentials, answers, paragraphs, file body or model call is returned.
It is a point-in-time packet proof, not approval, physical availability or a cleanup certificate.

The Documents private scalar client pins one configured HTTPS origin, forwards the current
verified token only in Authorization, refuses redirects, requests no-store and makes one attempt.
It reads at most 4 KiB of expected JSON, rejects unknown/body-bearing fields, wrappers, ownership/
generation/hash/version/time changes and expiry, and reconstructs only the original private
reference using its fixed owner/application. Known 409 is negative authority; all other failures
are fixed unavailable errors. Token/response data is not persisted. It awaits actual fetch/read
settlement after cancellation; no Promise.race or retry grants new authority. Controlled received
buffers clear and response streams cancel on all outcomes.

The native listener's authorization capability now receives the current verified request token
for this scalar check. Its content response uses direct existing preview/file JSON, correcting
the prior source-only `data` wrapper. Linux fixture output now validates against the actual public
component. The same native process keeps its original kernel deadline; HTTP never renews it.

Implementation: [scalar client](../../../../backend/services/documents/src/native-read-authorization-client.ts),
[owning service](../../../../backend/services/applications/src/service.ts),
[Gateway](../../../../backend/gateway/src/app.module.ts),
[OpenAPI source](../../../../packages/api-contracts/openapi/platform.v1.json).
No SQL/domain/event schema or migration changes. API types are regenerated, never hand-edited.
The new route/schema is additive; previous consumers remain compatible and old runtime
compositions fail closed for the new capability. The unactivated native prototype wrapper changes
to match the established public response contract.

## Targeted local evidence

- 21 scalar client units pass, including strict scope/origin/refusal, wrong/malformed/body-bearing
  responses, fixed origin/token forwarding, deadline mismatch, known conflict and actual pending
  promise after cancellation. Synthetic fetch ports are used in these units.
- 96 API contract tests pass, including nine strict scalar-schema cases. Route enumeration and
  scope/no-store/idempotency assertions explicitly include the new read. Gateway route suite passes
  97 tests with three opt-in skips; three new authenticated query/scope/owner-argument cases.
- All 28 real PostgreSQL Gateway owner-composition cases pass, including five new authorization
  cases: positive original proof, foreign owner, expiry, committed terminal state and default-off.
  Positive proof also traverses the actual scalar client and authenticated Gateway HTTP handling.
  Original dispatch, native completion, real memory/render and SQL packet persistence are actual;
  provider/managed OIDC/catalog are simulated. Metadata HTTP uses the real Gateway's injection
  adapter; it is not a deployed network journey. Log/receipt: `.tmp/d3-native-authz-sql.log` /
  `.tmp/d3-native-authz-sql.exit` (0).
- Initial cold fixture run refused twelve readiness results before new authorization access.
  Single-case and full diagnostic reruns passed without establishing the exact original cause.
  The synthetic provider fixture now takes PostgreSQL's clock sample during its actual fake
  completion and SDK observes that same fixed clock. Production timestamp checks, max expiry,
  trigger and actor behavior are unchanged. No production clock-conformance claim follows.
- Expanded Linux run passes 16 actual content-process cases, including 28 HTTPS checks. The
  actual scalar client forwards and re-verifies signed synthetic JWTs against a simulated
  Gateway fetch port and actual owning scalar helper. Actual TLS/certificate/hostname, direct
  schema-valid preview/files, packet revocation, pending-call/disconnect admission and original
  deadline SIGKILL remain covered. A production-environment attempt to inject the test verifier
  is now rejected in the actual Linux fixture. Provider/SQL view/renderer/managed identity are
  synthetic in this kernel test. Log/receipt: `.tmp/d3-native-authz-linux.log` /
  `.tmp/d3-native-authz-linux.exit` (0).

Final clean-source SQL/Linux/full maintained verification is pending at this start record.
No live provider/Auth0/ATS/AWS task or UI/browser journey is claimed. The native endpoint and
feature's actual UI target are unavailable because launch/registry/approved managed routing
are not composed. Existing hosted UI and local Gateway content checks do not certify native
production transport or physical cleanup of frozen Lambda/client copies.

## Remaining gates

D3-079/D3-064 and D1/D3 remain In progress. Private launch admission, exact allocation registry,
reviewed image, private evidence/work/completion adapters, approved TLS/DNS/task routing and
positive managed stop remain unfinished. Complete client routing/logout/idle lifecycle, temporary
resume/edit lifecycles, ATS handoff and D3-012 no-training/retention/entity/region approval remain.
Metadata authorization is not a substitute for these requirements. Confirmed/ambiguous evidence
and duplicate guards are unchanged. ADR-040 remains Proposed; no new deployment authorization.
Hosted CI/CD remains deferred until production launch.
