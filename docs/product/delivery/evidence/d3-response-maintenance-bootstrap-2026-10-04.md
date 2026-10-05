# D3-066: Source-only native response maintenance

Date: 2026-10-04
Status: Source/local verification complete at `a63233a`; review/merge and release gates remain.

The backend-only branch starts from freshly fetched main `bde17d9` and locally integrates
exact open #535 `0c91183` as an explicit dependency. This is not a GitHub merge.

## Capability and acceptance

The path is: trusted private maintenance reference → internet maintenance Lambda →
Documents-owned private eligibility RPC → failed-only private fence → fixed provider cleanup
→ Documents-owned disposal receipt → owning eligibility read proving durable convergence.
Successful maintenance omits fencing and cancellation entirely.

A closed private v1 input selects `reconcile_failed` or `reconcile_completed` and carries only
the original provider work reference. It carries no candidate owner, provider response id,
failure classification, content, key or receipt. Exact-echo output contains only that metadata
and `unresolved`/`response_disposed`. A selector is not evidence of failure or success: only
the owning `read_failed`/`read_completed` supplies eligibility. Unknown identity and missing
proof have no ordinary-inventory fallback. Already-disposed reads need no provider key/effect.

Configuration defaults off and requires us-east-2, the configured account, exact numeric
invoked target, distinct numeric private fence/disposal functions and a same-account managed
provider-secret ARN. SQL settings, plaintext provider keys and document bucket/KMS settings
are refused. Target matching is a configuration fence, not caller authentication.
Native Lambda clients use one attempt and ignore configured endpoint overrides. The new
fence client bounds requests/responses to 8 KiB, validates exact version/reference/purpose,
rejects log tails/errors/noncanonical JSON/invalid UTF-8 and does not retry ambiguous effects.

Managed-key access occurs inside the selected cleanup capability after eligibility and
failed-only fencing. The existing fixed-extension resolver bounds its own read. The key is
local to that invocation; no warm cache or shared provider object retains it. The invocation
has a bounded local deadline, including eligibility and key access. Late key completion
checks expiry/activation before provider effects. Local cancellation is not remote stopping.
The existing AI SDK cleanup does one original GET, at most one failed-only cancel, and one
DELETE after exact original terminal proof. A provider 404 never establishes disposal.

## Executed evidence

- Documents typecheck passes.
- 49 focused synthetic tests compose the actual private handlers and AI SDK transport. They
  cover both paths, absent/unknown proof, failed-only cancellation, target/configuration/
  activation changes, key rotation across calls, stalled key reads, provider 404, exact
  fence transport refusal and lost committed disposal acknowledgement replay. Installed AWS
  SDK serialization tests confirm one HTTP attempt on success and server error.
- 141 response-inventory PostgreSQL cases pass, including nine new cases connecting the native
  internet maintenance entrypoint and both native private SQL bootstraps. These cover all
  three failure statuses, successful generation, active/legacy/unknown refusal, quarantined
  failure and lost committed disposal ACK. Another private writer remains running after
  failed cleanup; document deletion still refuses. Ineligible rows remain byte-for-byte
  unchanged and trigger no fence, secret read or provider effect.
- PostgreSQL 16.14-alpine, an owned loopback-only tmpfs fixture `work_ledger_d3_066` on 55438;
  real Documents/Profile migrations and SQL transactions. Secret, Lambda authentication and
  provider HTTP are synthetic. No live model/provider/AWS call occurred.
- The bundle guard inspects actual emitted module contributions, since parsed barrel reexports
  include zero-byte generation modules. It excludes emitted SQL/private persistence, S3,
  rendering, initialization, provider dispatch/capture, gateway and generation code. Provider
  cleanup and both maintenance clients are positively required. A diagnostic local artifact
  builds and its actual exported handler proves default-off and extra-content refusal with
  zero fetches. It is not yet bound to a clean committed source or published.

Local logs (ignored): `.tmp/d3-066-focused.log`, `.tmp/d3-066-typecheck.log`,
`.tmp/d3-066-integration.log`, `.tmp/d3-066-build.log`,
`.tmp/d3-066-artifact-diagnostic.log`. The owned container is removed after the SQL checks;
Docker Desktop and WSL are stopped, retaining shared volumes.

## Remaining release gates

Full repository verification and clean committed artifact binding remain pending. The new
source builder has its own internet-maintenance output directory and does not alter the
SQL-control or isolated-generation publisher inventories. Publication, runtime IAM, secret/
private-caller grants, maintained scheduling/durable owning caller, retention/expiry and deployed
acceptance still require implementation/review. Migration 0009 from #535 must precede updated
owning functions. No new migration, OpenAPI, domain/event shape or frontend change is introduced.
This does not classify ambiguous abandonment, settle other writers, prove privacy quiescence,
authorize finalization/purge or supply accountable security/privacy approval. D1/D3 remain
In progress; no phase-exit box changes and hosted CI/CD remains deferred until production launch.

## Final exact-source verification

The earlier pending full-verification/artifact checkpoints are superseded by these results
for clean source `a63233a3989ae60f4829a5dd5671a829ca0793ae`:

- Full `scripts/verify-phase0.ps1` passes: 38 typecheck tasks, 39 test tasks and 23 builds,
  contract generation, formatting, operational/security/recovery guards, both bundle isolation
  checks, Compose configuration and product-scope check. Lint is unchanged at zero errors,
  15 warnings and 58 infos. All 1,155 Documents unit cases pass. External integration suites
  skipped by the maintained unit runner are not claimed tested.
- The new local artifact binds the exact clean source in its bundle/manifest. Independent
  ZIP contents, bytes/hash, bundle/source banner, manifest, checksum companion and 26-component
  SBOM checks pass. Artifact SHA-256:
  `af2bc781ac248284bfbe5d1fd04def32d67b1113370946c16187ba4620c20361`.
  Both actual bundled selectors refuse while disabled, reject injected provider identity and
  perform zero transports. It remains unpublished; no runtime release receipt is claimed.
- All original tracker and phase nonblank lines from dependency `0c91183` are retained in order;
  new relative evidence links resolve. Follow-up changes record results/table placement only.

Logs: `.tmp/d3-066-full-verification-a632.log`, `.tmp/d3-066-artifact-a632.log`.
The 141 PostgreSQL cases above bind the same production source bytes (subsequent changes before
commit were documentation, formatting and artifact/check composition). These checks were local
Windows/Node 24/pnpm 10 with real PostgreSQL 16.14 and simulated external authentication, secrets,
Lambda transport and provider responses. There was no user-facing change requiring a UI pass.
Reviewed IAM, maintained caller/scheduling, retention/expiry, abandonment/writer drain and
accountable/deployed acceptance remain. D1/D3 are not complete.

Review: [PR #536](https://github.com/Vrixic/project-ai-job-apply/pull/536) is open, stacked on exact #535 source 0c91183.
The tested production source and artifact remain a63233a; later commits only record evidence.
No GitHub merge, deployment, activation or hosted-check monitoring is performed.
