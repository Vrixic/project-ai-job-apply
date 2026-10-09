# D3 connected browser safety â€” 2026-10-09

Status: locally verified implementation batch; D3 remains in progress. No deployment or live
candidate/employer acceptance is claimed. Independent D1 acceptance, including hosted admin,
is deferred.

## Implemented

- Review resets when the packet changes; actions lock while pending. Sensitive boolean fields
  require an explicit choice and preserve false. Temporary materials require an available exact
  preview and explicit review before approval.
- Resume preview/download checks bind content hashes and all temporary-material scalars to the
  approved packet. The original completion-plus-30-minute deadline is validated, never extended.
  Idle/focus expiry hides previews and disables material use; late downloads and navigation are
  aborted, decoded bytes cleared and Blob URLs revoked. Logical browser cleanup does not prove
  physical erasure of all copies or delete files intentionally downloaded by the candidate.
- Preparation retries keep an opaque action key for identical inputs; changed answers get a new
  key. Confirmation retries retain their original timestamp/fingerprint. Job changes reset the
  workspace and confirmed history refreshes from its owner-scoped API.
- BFF routes validate asynchronous preparation responses and owner/application binding, plus
  scalar-only native material locations and their kind/generation/deadline. They do not proxy
  generated content through serverless. The subsequent D3-083 batch adds direct browser native reads.
- Search heading order and filter-label contrast were the only independent D1 source changes,
  required by actual connected-browser accessibility failures.
- The verifier and CI build before tests: native-resume control tests import the actual emitted
  workflow handler, which was absent on this checkout. No test assertions or timeouts were relaxed.

## Executed checks

Sources: [workspace](../../../../frontend/web/app/applications-workspace.tsx),
[review](../../../../frontend/web/app/application-review-panel.tsx),
[material lifetime](../../../../frontend/web/lib/application-material-lifetime.ts),
[BFF](../../../../frontend/web/lib/applications-bff.ts),
[connected browser test](../../../../scripts/tests/d3-browser-assurance/run.mjs).

- Web tests: 63 files, 800 tests passed. Web typecheck and API contracts build passed.
- Actual Chromium harness mounts the production search, workspace, review, Apply, history and
  preview components. Search â†’ Prepare â†’ review â†’ approve â†’ manual Apply â†’ candidate-attested
  confirmation â†’ Applied history passed with synthetic BFF/native-preview responses. Keyboard,
  axe checks and idle-preview expiry passed; local/session storage stayed empty. This does not
  test live generation, actual employer form submission or provider confirmation.
- Regressions cover packet acknowledgement resets, action locks, exact material/hash/deadline,
  stale downloads/navigation, explicit false, response-loss retries, changed-answer keys,
  history cursor loops and asynchronous/location response substitution.
- No PostgreSQL integration, live provider/model, managed OIDC or actual employer submission was
  run. Standard suites retain their documented integration skips; no persistence code changed.
- Every repository-verifier stage passed across the full and resumed runs: 39 test/build tasks
  in the test graph, 23 production builds, formatting/lint/typechecking, dependency security,
  operator/contract guards, bundle isolation and Compose validation. The full command was run;
  after local prerequisite repairs its literal remaining stages were resumed from temporary
  scripts without weakening checks. Its first run found missing
  workspace dependency links; frozen-lockfile installation restored them without a lockfile change.
  A later run found CRLF in the working-tree profile foundation migration; restoring its documented
  LF form reproduces the existing manifest checksum with no migration-content change.
  Installed braces lacked the committed security patch; a forced frozen-lockfile reinstall
  restored it. All 56 braces regressions and the complete dependency-security suite then passed.
  Dependency-dependent verifier stages were resumed from formatting. Missing emitted workflow
  artifacts were repaired by building first; all 1,937 Documents tests then passed. A focused
  handler run during concurrent builds timed out; after builds finished all eight cases passed
  unchanged. The final resumed run exited zero with the verifier success marker.

## D3-081 preparation client follow-up

The separate default-off cover-letter UI now uses the existing versioned disclosure for an
explicit request. It accepts an asynchronous operation, retains admission body/key on identical
retry, polls only that operation (120 reads/four minutes; 15-second request bound), and checks
current application/immutable result bindings before restoring review. Pending work hides
review/Apply; cancellation reads the latest revision. Late reads cannot restore cancelled state.
Status retries never redispatch generation and a new draft requires a new opt-in. Preview
availability/acknowledgement now compare every material-reference scalar, preventing an earlier
version's preview from authorizing a later version of the same generation.

Sources: [preparation client](../../../../frontend/web/lib/application-preparation-client.ts),
[bounded status UI](../../../../frontend/web/app/application-preparation-progress.tsx).
All 43 focused regressions and the expanded actual Chromium harness pass with synthetic responses;
the browser exercises opt-in, queued/running/succeeded metadata, exact-preview approval blocking
and keyboard/axe checks. The full scripts/verify-phase0.ps1 run exited zero: 64 web files/812 tests,
23 builds, 39 test/build graph tasks, guards, security checks and isolation/Compose checks passed.
No live generation/provider activation
or native content transport is claimed. The flag must stay off until the owning release gates close.
Merged in [PR #606](https://github.com/Vrixic/project-ai-job-apply/pull/606).

## D3-082 form-plan safety follow-up

Static inspection found conflicting label/name claims chose one taxonomy key, normalized duplicate
options chose the first match, and a challenge flag still accompanied fill/attachment actions.
The planner now refuses these actions. Restricted authorization/demographic/disclosure fields
always require candidate action, including previously reviewed packet values, enforcing the
owner-adopted zero-sensitive-fill threshold in the D3-013 fixture request. No API/persistence
shape, adapter activation, provider scope or external effect changes.

All 20 synthetic SDK tests pass, including five new regressions. The actual Chromium connected
journey was repeated and passed with synthetic BFF/native responses; it still proves no live
generation, provider fidelity, external submission or installed-extension acceptance.
Source review: [PR #607](https://github.com/Vrixic/project-ai-job-apply/pull/607).
The final full verifier exited zero on D3-082 code: 38 typecheck tasks, 23 production builds,
39 test/build graph tasks, security/operator checks, native bundle isolation, Compose and scope
checks passed. The web suite remains 812 tests; ATS SDK has 20. Live/SQL opt-in skips remain
explicit. Logs are ignored local files `.tmp/d3-form-plan-verify.log` and
`.tmp/d3-form-plan-browser.log`. An earlier verifier invocation was stopped when source inspection
expanded this batch to enforce the adopted restricted-field threshold; the final run passed whole.

## D3-012 review packet refresh

The [engineering approval packet](../../../security/d3-application-approval-packet.md) now
distinguishes implemented vault/protected-packet/preparation workflow/browser controls from
then-unfinished native identity, observed-form answer selection, provider adapters and live acceptance; D3-083 subsequently implements the native browser source.
The existing October 2 OpenAI development selection is acknowledged; it is not ADR-038
all-copy retention approval. The original accountable disposition is unchanged. Source/evidence
and local Markdown-link inspection validate this documentation-only update; no additional
runtime test or acceptance is claimed.

## Remaining work and genuine gates

GitHub Actions cannot start jobs: its check annotation reports failed recent account payments
or an insufficient spending limit. Remote CI is unavailable; billing settings were not changed.

The owner selected separate in-memory Auth0 popup PKCE on October 9 ([ADR-044](../../../adr/044-browser-native-material-identity.md)). D3-083 now implements default-off native browser reads and cover-letter preview/download UI. Subsequent signed-in dashboard inspection found no SPA and an application limit. After the owner explicitly confirmed repurposing Default App, it was configured as the separate native-material SPA with Authorization Code only, exact existing HTTPS candidate origin and only user-delegated `applications:read` on the platform API. Machine and anonymous platform access remain zero. Saved settings were inspected; live exchange and native acceptance remain unverified. No duplicate registration, token-returning BFF or serverless generated-content proxy was created.

Observed-form answer selection, Greenhouse adapter and extension application executor/handoff remain unfinished source work, dependent on the adopted authorized/independently accepted provider-derived fixture matrix. They are not represented as completed or solely external acceptance.
Live validation additionally needs disposable controlled sign-in/MFA, approved provider/model
configuration, authorized provider-derived fixtures, original-work cleanup/recovery evidence,
candidate rights/restore and accountable legal/security/privacy/product review. Existing
development-only manual Apply acceptance is preserved; this batch adds no live acceptance.

## Shutdown

No AWS runtime was started by this batch. Development account 362544434697, us-east-2, readback:
zero RDS instances, ECS running/pending tasks, live NAT gateways, interface endpoints, active
Lambda event-source mappings and API routes on Gateway lemwm7dvi4. No application schedules
were enabled; the GuardDuty service-managed protection rule is retained. Fifteen encrypted
manual RDS snapshots remain available. Durable recovery/storage/security/monitoring resources
remain and can incur charges; this is not a zero-cost claim.

Staging verification is blocked: profile ai-job-apply-staging-admin cannot load its separate
SSO token. Staging billable runtime state is therefore not freshly verified; required shutdown
verification remains incomplete for that environment. Docker Desktop status reports it is not
running and no Docker process exists; WSL shutdown completed and its running-distribution list
is empty. Additional development readback found no ECS services, enabled Scheduler schedules
or non-terminated EC2 instances.
The PC remains on.
D3-081 shutdown readback at 2026-10-09T16:09:28Z reconfirmed the development runtime counts above, no enabled Scheduler schedules, and no active Lambda event-source mappings. WSL shutdown completed with no running distributions or Docker processes. Staging SSO remains unavailable.
D3-082 development readback at 2026-10-09T16:20:50Z reconfirmed zero RDS/ECS/NAT/interface-endpoint/
API-route capacity and no enabled Scheduler schedules or active Lambda event-source mappings;
only the retained GuardDuty protection rule is enabled. Docker has no processes and WSL has no
running distributions. Staging still cannot load its separate SSO token; no browser SSO session
is available through the enabled browser surfaces. The PC remains on.


## D3-083 separate browser-native material batch

- Owner-selected separate Auth0 SPA popup PKCE, explicit memory cache, no refresh tokens/silent renewal, 65-second sign-in bound and ten-minute local credential lease. Late popup/read work cannot restore disconnected access.
- Scalar BFF proof -> configured UUID allocation HTTPS:8443 -> exact native content/reference -> fresh scalar proof; no generated content crosses the BFF. Allocation and original generation IDs can differ. Native exact-owner verification remains authoritative.
- Reads are bounded to 15 seconds/512 KiB with closed schemas, original expiry, full references and content hashes. Resume and cover-letter previews are inert and must both be reviewed before approval. Approved PDF/DOCX files require format/media consistency, byte count/SHA-256 and unchanged approval after asynchronous work.
- Exit/disconnect/credential or material expiry removes previews and approval availability; terminal application/packet replacement unmounts and aborts. Byte buffers are cleared, Blob URLs revoked; JavaScript strings have logical disposal only. Candidate-held downloads/employer copies are outside cleanup.
- 35 new auth/transport/UI/header regressions pass. Actual Chromium runs search -> opt-in preparation/status -> two native previews -> credential expiry/reconnect -> explicit material/contact review -> disconnect/reconnect -> approve -> four approved downloads -> manual candidate attestation -> confirmed history. Keyboard/axe and empty local/session storage pass. Authentication, BFF and native responses are synthetic; actual Auth0 popup exchange, native CORS/TLS, live generation or employer submission are not claimed.
- The complete `scripts/verify-phase0.ps1` rerun passed with exit 0: 38 typecheck tasks, 23 builds, 39 test-graph tasks, 847 web tests, security/operator/contract guards, bundle isolation and Compose/scope validation. The first run found a NodeList iteration typing error in a new test; using the established `Array.from` pattern fixed it without changing compiler settings. The final popup-header change is additionally checked in configured/default-off production builds. No API contract, persistence, provider activation or D1 hosted/admin acceptance changed.

- Cross-tab sign-out is exercised with two real Chromium tabs in one browser profile using the production signed-out signal. Unsupported BroadcastChannel blocks material access. The first browser fixture incorrectly used isolated profiles; fixing the fixture established the intended same-profile behavior without weakening source controls.
- A synthetic cross-origin popup proves opener communication under the scoped enabled header; existing employer/source links retain `noopener`. No actual Auth0 exchange is simulated by this popup proof.

### D3-083 shutdown readback, 2026-10-09

No cloud runtime was started. Staging account 908203540025/us-east-2 now has working SSO and fresh
readback: zero RDS instances, ECS running/pending tasks/services, live NAT gateways, interface
endpoints, non-terminated EC2 instances, EIPs, EBS volumes, Gateway fqqw9k9v44 routes, enabled
Scheduler/EventBridge rules, active Lambda event-source mappings, running durable executions and
provisioned concurrency on all six project functions. All three project queues/DLQs have zero
visible, invisible and delayed messages. Retained storage, recovery and security resources can
still incur charges.

Development's last successful readback is retained above; **fresh development verification is now
blocked** because `ai-job-apply-development-admin` cannot load SSO session `ai-job-apply`.
The available staging SSO identity is explicitly denied role credentials for development account
362544434697 (`ForbiddenException: No access`). No AWS profile, assignment, permission or token
cache was changed; a temporary public configuration check did not grant access. Required fresh
development shutdown verification remains incomplete, even though this batch started no resources.

Configured and default-off Next production builds both passed after the scoped popup-header change. Their emitted route manifests respectively contain the `/jobs` exception and retain only the strict global opener policy. The final local build is default off. At 2026-10-09T17:37Z, Docker Desktop status could not find a running Desktop service and no Docker process existed; `wsl --shutdown` completed with an empty running-distribution list. The PC remains on.


### D3-083 owner-approved SPA configuration follow-up, 2026-10-09

The dashboard saved and subsequently displayed the separate SPA name/type, exact callback/logout/
web origin, RS256/OIDC conformance, code-only grants and one platform user-delegated scope. An
initial save rejected the inherited client-credentials grant; removing that grant allowed the
public SPA configuration to save. No secret was copied or rotated. Public client identifiers
were saved only to ignored local configuration, with the native UI explicitly disabled.

Management API user-delegated access is inherited from its existing API policy; its panel lists
current-user operations and no per-app grant. No management grant or tenant-wide policy change
was made. The application requests only the platform audience/scope. Live Auth0 exchange,
same-owner native access and the managed release remain unverified. Configuration inspection
does not change D3 completion or independent D1 acceptance.

No AWS runtime was started during this configuration follow-up. Fresh staging readback again
shows zero RDS instances and ECS running/pending tasks/services. Development still cannot load
its SSO session, so fresh development shutdown verification remains incomplete. WSL shutdown
completed with no running distributions, and no Docker process was found; the PC remains on.


## D3-084 complete-form extraction and restored development access

Source inspection found silent prefixes at 200 fields, 250 options and 300 normalized text
characters. Extraction now throws a fixed content-free RangeError on overflow, including combined
accessible labels, so no partial model reaches hashing or planning. At the exact field limit,
remaining members of an existing radio group are still processed; any required member makes the
group required. Valid in-bound form shapes/hashes, public API contracts and persistence are
unchanged. Future adapter callers must handle refusal by leaving completion to the candidate.

All 24 synthetic SDK tests pass (four added tests plus replacement of the old truncation test),
with exact boundaries, hidden suffixes, duplicate options beyond the limit, long question/name/
option text, combined accessible labels and last-field radio requiredness. Package typecheck and
lint pass. The actual Chromium connected search/preparation/review/approval/manual Apply/
candidate-attested confirmation/history journey passes again, including native previews/downloads,
expiry/disconnect and keyboard/axe checks. Authentication, BFF and native responses are synthetic;
no live model, employer submission or native acceptance is claimed. The full
`scripts/verify-phase0.ps1` run exits zero: 38 typecheck tasks, 23 builds, 39 test-graph tasks,
847 web tests, security/operator guards, bundle isolation and Compose/scope checks pass. Logs are
ignored local files `.tmp/d3-form-extraction-verify.log` and `.tmp/d3-form-extraction-browser.log`.
Standard opt-in persistence skips remain; no persistence implementation changed.

Development SSO now verifies account 362544434697/us-east-2. The maintained native session
operator's read-only --check passes with signInStarted=false and cloudMutated=false. Fresh
shutdown inspection finds zero RDS instances, ECS running/pending tasks/services, live NAT
gateways, interface endpoints, non-terminated EC2 instances, EIPs, EBS volumes, API routes,
enabled Scheduler schedules and active Lambda event-source mappings. Only the retained GuardDuty
protection rule is enabled. All 12 project queues/DLQs have zero visible/invisible/delayed messages;
all three durable functions have zero running executions, and all 25 functions have zero
provisioned concurrency. Fifteen encrypted manual recovery snapshots are available. Retained
recovery/storage/security resources still incur charges. No cloud runtime was started.

Staging's separate SSO session is now unavailable (`ai-job-apply-staging` token missing). Its earlier
verified shutdown remains historical evidence; fresh staging verification remains incomplete.
The AWS access blocker has moved environments, not been waived.

Final local runtime inspection found no Docker process or running WSL distribution. WSL shutdown
completed; Docker Desktop status could not find a running service. The PC remains on.

## D3-085 staging shutdown status prerequisite

The owner restored staging SSO. The maintained status operator then failed because Lambda's
event-source-mapping list succeeds with no mappings even when its requested function does not
exist. The operator now resolves the exact optional processor from the paginated Lambda function
inventory. Failed inventory/mapping/rule reads refuse status; deployed document processing still
requires its own mappings and rules. No cloud resource, permission, artifact, contract or product
activation changed. This fixes the mandatory shutdown dependency without reopening D1 acceptance.

Nine generated regression cases pass: absent processor with empty mappings, deployed dark
processor, active base/document triggers and six failed-read paths. The cases are wired into the
full repository verifier. The corrected read-only lifecycle operator verifies `Mode=dormant`, no
database, zero managed interface endpoints/routes/enabled mappings/rules and zero queue depth.
Additional staging readback at 2026-10-09T18:54Z confirms no ECS running/pending tasks/services,
EC2 instances, NAT gateways, EIPs or EBS volumes. All three project queues/DLQs have zero visible,
invisible and delayed messages; all six functions have zero provisioned concurrency, and the
durable function has zero running executions. No runtime was started. Retained storage/recovery/
security resources can still incur charges.

The development session worked before the staging sign-in, but its named local SSO cache is now
absent. Earlier development shutdown evidence remains historical; fresh development verification
requires renewed sign-in. No token cache was copied or repaired, and no profile/assignment was
changed. The owner clarified that development and staging cannot be accessed together. Access and
shutdown verification will therefore be sequential: staging is verified before switching to
development; simultaneous sessions are not a requirement. The development browser authorization
attempt expired; the next live session needs fresh development sign-in after switching. Docker remains stopped, WSL shutdown completed with no running
distributions, and the PC remains on.

The complete `scripts/verify-phase0.ps1` run exits zero, including the new nine-case regression,
38 typecheck tasks, 23 builds, 39 test-graph tasks, security/operator checks and bundle/Compose/
scope guards. The actual Chromium connected journey passes again with synthetic authentication,
BFF and native responses; no live generation or employer submission is claimed. Logs remain
ignored locally at `.tmp/d3-staging-status-verify.log` and `.tmp/d3-staging-status-browser.log`.
All 37 local delivery/runbook link targets and `git diff --check` pass.
