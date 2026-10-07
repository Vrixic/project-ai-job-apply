# D3 native resume task and direct-read composition — 2026-10-07

D3-064/D3-079 remain In progress. This backend-only batch connects original retained-source
RPC to native resume generation, task bootstrap, image startup and current-packet authorization.
D1/D3 are not complete; ADR-040 remains Proposed. No cloud deployment, activation, publication,
new PR, main merge or hosted CI/CD was performed.

## Implemented

- Documents owns the resume task/runtime adapters and direct HTTPS preview/PDF/DOCX reader.
  Shared transport and ECS metadata helpers preserve the cover-letter path. One original
  generation is admitted per process; the real kernel arms before source content is loaded.
  Original completion and verified ready receipts remain scalar and do not extend expiry.
- The dedicated image composition authenticates separate numeric owner/source functions and
  reads one pinned TLS secret. Its build recipe and entrypoint exclude model, SQL, S3/ECS/KMS
  and owning-service code. This batch adds the recipe; no built production-image conformance
  is claimed. Source smoke tests exercise its startup factory.
- Applications/Gateway expose the default-off, owner-scoped scalar resume authorization route.
  Exact current packet, resume hash, generation, expiry and owner are checked; the direct task
  repeats authorization and admission around held reads. Gateway returns no generated body on
  this route. Existing `NATIVE_MATERIAL_READ_AUTHORIZATIONS_ENABLED` plus packet-protection
  admission gates both material authorization routes; activation remains unchanged.
- OpenAPI v1 adds optional `temporaryMaterial` on resume preview/file responses. New validators
  accept old responses; old strict validators must be upgraded before returning the new field.
  The new route uses existing authorization metadata, UUIDv7 generation query, `applications:read`
  and `no-store`. No migration or frontend source change is included.

## Local evidence

- Gateway dependency build passed. Documents focused suite: 89 passed. Gateway controller and
  Lambda boundary suites: 220 passed, 3 existing skips. Applications policy/service suites: 28 passed. Emitted capability checks: seven passed.
  Repeated contract generation is byte-identical; changed-file formatting and diff checks pass.
- All 42 actual Linux process cases passed in the serial run, including five new resume-runtime
  cases: direct composition, task bootstrap, image startup, explicit termination and pending
  ready publication. Real signing, TLS, PDF/DOCX generation/verification and kernel SIGKILL were
  exercised. Every successful resume mode verifies preview and both files, current-packet races,
  authentication/scope, request framing, TLS/CORS, concurrency and unchanged original expiry.
- AWS identity/Lambda delivery, secret responses, owner store and candidate authentication are
  synthetic test ports. The fixture makes no AWS/model call. It is not managed OIDC, IAM,
  deployed Gateway, real candidate acceptance or production-image proof.
- The expanded Linux suite exceeded its previous two-minute runner limit; the bounded aggregate
  limit is now three minutes. An overlapping-build run subsequently failed the existing delayed
  cover-letter startup wall-clock assertion. The serial rerun passed all 42 with the original
  per-case deadline/fallback assertions unchanged (135.9 seconds total).
- Logs: `.tmp/d3-native-resume-connected-linux-serial.log`,
  `.tmp/d3-native-resume-connected-unit.log`, `.tmp/d3-native-resume-connected-gateway.log`,
  `.tmp/d3-native-resume-connected-applications.log`, `.tmp/d3-native-resume-connected-bundle.log`.
  See the frozen-source verification record below.

## Remaining work

Connect original resume reservation/RunTask dispatch to preparation and packet attachment, direct
read location, clients and ATS upload; verify the built image and managed deployment/IAM/TLS path.
Accountable release gates remain. Previously accepted D1 sign-in/search/Profile/save-reload checks
are not reopened; preference write/read and resume import remain unverified. Owned Linux fixture
cleanup is complete; shared volumes retained. Docker/WSL are stopped; the PC stays on.

## Frozen-source verification

Runtime source: `14bad3bd6fd612052670e0a53c29462c09d3041e`. The full verifier passed every stage
through type checking (38 tasks), with the existing lint baseline of zero errors, 15 warnings
and 58 infos. It then stopped on two stale API contract test inventories: the route count and
body-free read list. Commit `d62d58fd03032a26dcc8409bf1f47d586d4d74c7` updates those expectations
and adds legacy/native response compatibility and private-metadata rejection coverage.
Production source is unchanged. All 105 API contract tests pass after the correction.

The exact maintained verifier remainder, starting at workspace tests, ran on clean frozen
`d62d58fd` with matching `ARTIFACT_SOURCE_SHA`. All 39 test tasks, 23 build tasks, bundle isolation,
Compose and scope checks passed; process exited zero. No tracked edits occurred during either
run. This is segmented verification, not an uninterrupted full-verifier pass. Logs are
`.tmp/d3-native-resume-connected-full.log`, `.tmp/d3-native-resume-contract-fix.log` and
`.tmp/d3-native-resume-connected-remaining.log`. No new production image was built or deployed.

Development web is restored against the existing development API: anonymous `/` returns 200
and `/resume` redirects with 307. This is startup/anonymous health only, not a new managed
sign-in or resume-import acceptance claim.
