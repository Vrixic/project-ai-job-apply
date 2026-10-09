# D3 connected browser safety — 2026-10-09

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
  generated content through serverless. Direct browser native reads are still unfinished.
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
  preview components. Search → Prepare → review → approve → manual Apply → candidate-attested
  confirmation → Applied history passed with synthetic BFF/native-preview responses. Keyboard,
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
unfinished native identity, observed-form answer selection, provider adapters and live acceptance.
The existing October 2 OpenAI development selection is acknowledged; it is not ADR-038
all-copy retention approval. The original accountable disposition is unchanged. Source/evidence
and local Markdown-link inspection validate this documentation-only update; no additional
runtime test or acceptance is claimed.

## Remaining work and genuine gates

GitHub Actions cannot start jobs: its check annotation reports failed recent account payments
or an insufficient spending limit. Remote CI is unavailable; billing settings were not changed.

Native material identity transport is unresolved: existing web tokens are server-held, while
ADR-038 requires direct browser-to-native content reads. Owner choice is pending between a
separate in-memory browser sign-in and extension-mediated material access. No token-returning
BFF or serverless generated-content proxy was added. Cover-letter preview/download UI,
saved-answer selection bound to an inspected provider form, and Greenhouse adapter integration
remain unfinished source work; they are not all external blockers.

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
