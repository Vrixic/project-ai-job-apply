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

## Full-verifier routing correction

The first resumed full verifier on clean `ecb31c8f` fails the Gateway contract-route test:
Nest serves the new authorization route but the independent API Gateway Lambda allowlist returns
404. This is an implementation gap, not a hosted-CI failure. The Lambda adapter now recognizes
only GET on the exact UUIDv7 application path, requires one bounded UUIDv7 generation query,
refuses missing/repeated/extra queries and bodies, requires the existing trusted authorizer
context, and forwards through the ordinary invocation principal bridge. It does not enable the
Applications capability or bypass owner/scope checks. All 113 Lambda adapter tests pass, including
eight new malformed/authentication/framing cases and the existing complete OpenAPI enumeration.
Log: `.tmp/d3-native-authz-lambda.log`. A corrected clean-source full verifier is required.

The final frozen `ecb31c8f` SQL and Linux runs separately passed 28 and 16 cases respectively:
`.tmp/d3-native-authz-sql-final.log` / `.tmp/d3-native-authz-sql-final.exit` (0), and
`.tmp/d3-native-authz-linux-final.log` / `.tmp/d3-native-authz-linux-final.exit` (0). The subsequent
routing correction changes only the Lambda adapter/tests and this evidence, so those distinct
owner/native proofs remain evidence for unchanged implementations. Exact owned fixture cleanup
completed, Docker Desktop and WSL stopped; no shared volumes removed.

## Final local verification and review base

Clean corrected source `a5c29ef737c30ec1dd5b10e551e7214a9cefc1c4` passes
`scripts/verify-phase0.ps1`: 38 typecheck tasks, 39 test tasks and 23 builds; formatting,
operational/security guards, emitted bundle isolation and Compose validation pass. Lint remains
zero errors, 15 existing warnings and 58 informational notes. API 96, SDK 293, Applications 224,
Documents 1,328, Gateway 318 and Workflows 1,588 tests pass. Gateway's 66 and Workflows' 57
opt-in skips are explicitly not new SQL/deployed evidence. Log/receipt:
`.tmp/d3-native-authz-verify-corrected.log` / `.tmp/d3-native-authz-verify-corrected.exit` (0).
The first resumed full run failed as recorded above; the corrected terminal run supersedes it.

The maintained build ran locally on Windows with Node 24.12.0, pnpm 10.24.0 and Terraform 1.16.2.
The separate final SQL run used local PostgreSQL 16.6; the Linux process run used existing pinned
Node 24.21.0/GCC Linux AMD64 image
`sha256:64af3819f9275802414d7cdc38c27e9d82bd564dec4d4da87d008255d36c63b4`,
network disabled and bounded tmpfs. Synthetic identity/provider ports remain distinct from live
managed identity/provider behavior. No browser journey is claimed for the uncomposed native UI.
No implementation changed during the corrected full run; only delivery documentation follows.
All verifier handles are terminal. Docker Desktop/WSL remain stopped.

The previously reviewed backend stack was topic-merged rather than main-integrated.
[PR #556](https://github.com/Vrixic/project-ai-job-apply/pull/556) presents exact merged #555
`01624a0c` to main; its entire tree equals reviewed #555 `8edcc3df`, and it has no frontend diff.
The focused authorization branch incorporates that identical baseline ancestry without changing
its source tree. This keeps the new route/client/Lambda correction review separate from the
already-reviewed stack. No authored merge to main, deployment, activation or CI/CD work occurs.
D3-079/D3-064 and D1/D3 stay In progress behind the remaining gates above.

2026-10-05 D3-079 focused scalar authorization source is reviewable in
[PR #557](https://github.com/Vrixic/project-ai-job-apply/pull/557) on
[PR #556](https://github.com/Vrixic/project-ai-job-apply/pull/556), the exact previously reviewed
backend consolidation. Tested implementation `a5c29ef7` is unchanged; subsequent commits record
delivery evidence only. Two authored PRs are open. D1/D3 stay In progress; no authored main merge,
deployment or activation, and hosted CI/CD deferred until production launch.

2026-10-05 independent merge of #556 integrates the reviewed baseline into main
`9478f068`; its complete tree equals exact baseline `01624a0c`/reviewed #555 `8edcc3df`.
#557 is retargeted to main. Incorporating identical main ancestry changes no files; verified
implementation `a5c29ef7` remains unchanged apart from delivery documentation. One authored PR
remains open. No authored main merge, deployment or activation; D1/D3 remain In progress and
hosted CI/CD remains deferred until production launch.
