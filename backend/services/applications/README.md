# Applications Service

Owns application packets, field proposals, review requirements, approvals, attempts, confirmation
evidence, audit history, and technical application history through confirmed submission
([ADR-024](../../../docs/adr/024-application-history-and-inbox-phase-ownership.md)). `applied` is
terminal, and no recruiter, interview, offer, or rejection result is stored or modeled.

## Current D3 slice (source and local verification only)

Submission dispatch rechecks current owner job/artifact bindings and the original packet/approval
under the application lock. Expiry is evaluated after those SQL reads. A stale queued attempt
settles as `failed_no_effect`, invalidates approval and returns directly to review with one revision
and one status outbox event; its two history entries and approval change commit atomically before
the fixed HTTP conflict. No intermediate approved event or dispatch permission is emitted.
Concurrent and repeated deliveries cannot dispatch that attempt. A fresh packet and explicit
approval can start a new attempt. The internal store requires a detached current-binding snapshot;
it never falls back to the original packet's values. The public dispatch signature is unchanged.
The endpoint carries the original form context, not a newly observed employer form; the adapter
must independently validate the destination structure. Owner reads remain point-in-time snapshots,
not a cross-owner lease. Vault-version invalidation and enabled-ATS/browser acceptance remain open.

### Cover-letter preparation in progress (2026-10-02)

The unshipped D3-017 slice adds an atomic base packet, short-lived disclosure-bound preparation,
identifier-only event, audit and idempotency receipt. A write-ahead claim permits exactly one
generation dispatch. The activity recovers only an already-persisted draft on retry, rechecks
current evidence/job/application bindings, and finalizes a new packet requiring explicit review.
Candidate edits cannot be silently superseded. Local Applications unit tests (98) and real
PostgreSQL integration tests (43) pass; these are layer evidence, not a connected product.
Documents generation now has local unit/database evidence, including pending-dispatch recovery.
The durable/private activity factories now pass 18 SDK unit tests and four connected PostgreSQL
tests with synthetic evidence and offline provider/object transports. Production owned outbox
dispatch, terminal recovery, ADR-016 isolated provider composition, production Gateway ports, privacy
artifact-content export and restore-boundary wiring remain unfinished. No live model call or AWS
deployment is enabled or claimed. Existing clients that omit opt-in keep the synchronous contract.

The Applications service and Gateway handlers now route explicit opt-in to `202` preparation,
preserving the synchronous `201` path. Owner-scoped status returns an immutable packet/revision
reference; later application edits cannot change that result. Receipt preflight checks ownership
and canonical request identity before volatile context/base-packet reads, without renewing consent.
Preview/file reads are exact packet-hash reads and never generate; approval resolves the current
Documents binding and fails unavailable on transport errors rather than inventing a changed draft.
Applications now passes 114 unit and 55 real PostgreSQL tests. Gateway scope/validation tests
use test authentication and fake owner ports, not live managed OIDC. Production preparation stays
default-off until its compatible migrations and dispatch/recovery runtime are composed.

Migration `0005_preparation_dispatch.sql` adds identifier-only owned dispatch metadata with
bounded nudge/dispatch leases, immutable original numeric workflow targets, start receipts and
terminal settlement. Foreign preparation nudges cannot claim another event. Lost Invoke receipts
retain the original binding for recovery; AWS success never promotes an active draft operation.
This is local persistence evidence, not deployed scheduling or terminal-handler composition.
Known execution polls now claim the existing scheduling timestamp under `SKIP LOCKED`, with
a sixty-second lease and oldest-claim-first ordering. Published rows reuse this field only for
status polling; unpublished nudge claims remain separate. Concurrent polls cannot claim the same
row, and old running executions cannot starve later terminal ones. No applied migration changes.

Implemented and locally verified against generated-synthetic data; **not deployed**. The OpenAPI contract and gateway
routes exist but fail closed (503) until a store is wired, and it is not part of candidate export/deletion yet.

- `src/state-machine.ts` - the eight-state lifecycle (`preparing`, `review_required`, `approved`,
  `submitting`, `takeover`, `reconciliation_required`, `applied`, `cancelled`), a closed set of
  technical history kinds, and a guard that refuses hiring-outcome vocabulary.
- `src/field-policy.ts` - review classification. Restricted answers are always shown; a
  `never_infer` answer is dropped unless the candidate supplied it (or it is a confirmed vault
  entry); attestations, signatures, and challenges are always direct candidate action; unsupported,
  unconfirmed, low-confidence, unknown, and generated values are never silently applied.
- `src/packet.ts` - packet assembly with a deterministic content hash (excludes ids, timestamps and
  approval state), approval that must acknowledge every reviewable field, and approval validity
  bound to the job revision, form hash, resume/cover-letter hashes, and a 24-hour age limit.
- `src/attempt.ts` - write-ahead dispatch, conservative result classification (every unclear
  post-dispatch result is `ambiguous`, never a plain failure), stale-attempt recovery, and
  reconciliation. An attempt that was dispatched is never dispatched again.
- `src/current-action.ts` - the single next candidate action, derived from source truth and never
  stored.
- `src/database.ts` - `createApplicationsDatabase`, the dedicated plain client the store requires. Never give the store the gateway's shared Profile/Drizzle client (camel-cased columns, string timestamps, identity JSON serializer): a create fails on it with `ERR_INVALID_ARG_TYPE`.
- `src/store.ts` - owner-scoped PostgreSQL store. Every command locks the application row, checks
  an idempotency receipt, checks the expected revision, and commits state, revision, append-only
  history, and a minimal identifier-only outbox row in one transaction.
- `migrations/0001_applications_foundation.sql` - the `applications` schema. The database enforces
  legal status transitions, terminal immutability, append-only packets/history/receipts, immutable
  approval evidence, one live approval per application, and a partial unique index that permits only
  one scope-holding attempt per (user, application, packet).
- `migrations/0002_candidate_rights.sql` - candidate-rights participation (D3-014). Every table stays
  append-only except for the privacy-authorized deletion of the exact candidate; adds
  `applications.export_candidate_data(uuid)` (candidate-readable technical state and packet answers,
  without owner identifiers, scope keys, consent references, or evidence fingerprints) and
  `applications.delete_candidate_data(uuid, uuid)` (children before parents). The aggregate export and
  deletion workflows call them only for a candidate-rights policy whose owner inventory includes
  `applications` (`d3-development-synthetic-v1`); see the phase record for the activation status.
- `migrations/0003_manual_submission.sql` - extends the idempotency-receipt operation allowlist for
  a candidate-started manual attempt. The existing attempt and application guards already support
  takeover before dispatch and candidate-attested reconciliation, so no state transition changes.

- `src/lifecycle-acceptance.ts`, `src/run-lifecycle-acceptance.ts` - the generated-synthetic fixture for the deployed lifecycle acceptance. `prepare` creates two generated identities; `cleanup` deletes the owner's Applications data through the privacy-authorized function, then the identities, and proves every owned count is zero. It refuses a contaminated boundary and accepts no SQL or candidate values. Driven only by `scripts/operate-development-applications-acceptance.ps1`.

- `src/service.ts` - the owner-scoped `ApplicationsApi` used by the gateway: maps store views to the
  generated OpenAPI types, takes packet, live-binding, and job-gate ports, and emits best-effort
  metrics. Every method takes the authenticated owner; nothing accepts an owner from a caller.
  Manual submissions start already taken over with adapter identity `manual`/`none`, perform no
  dispatch, and use the same reconciliation route as an ambiguous adapter result.
- `src/packet-source.ts` - builds packet proposals from candidate-confirmed, usable facts only (one
  documented exact mapping today), leaves competing facts to the candidate, and lets candidate
  entries win.
- `src/metrics.ts` - closed telemetry envelopes and allow-listed names/string dimension tokens, per-field
  correction, attempt outcome and latency, generation outcome, and rates by adapter/variant/model/prompt
  version.

Metric validation rejects extra envelope fields (including hidden/symbol properties), inherited
or non-record payloads, accessors and coercible non-string dimensions. Recording uses a detached
snapshot, so a sink cannot mutate its caller and subsequent caller changes cannot alter retained
events. Invalid events and sink failures remain best effort and cannot change candidate responses.
This is envelope hardening, not production analytics activation or complete dimension privacy:
token syntax does not exclude identifiers or bound cardinality. Registered dimension identities,
explicit analytics preference/API approval, a production sink and accountable privacy review
remain D3-010 prerequisites.

Tests: 56 unit and 25 PostgreSQL integration tests, including lifecycle parity between the domain and the
database guard, cross-owner isolation, an 8-way concurrent submission race, no-value-leak checks, and crash
recovery.

## Verify

```powershell
pnpm --filter @ai-job-apply/applications-service typecheck
pnpm --filter @ai-job-apply/applications-service test
pnpm --filter @ai-job-apply/applications-service build
$env:DATABASE_URL = "postgres://ai_job_apply:local_only@127.0.0.1:55432/ai_job_apply"
pnpm --filter @ai-job-apply/applications-service test:integration
```

## Not yet implemented

The durable stale-attempt recovery scheduler and outbox publisher, Documents/Jobs adapters that supply
artifact and job-revision hashes, vault-backed proposals and further fact-to-field mappings, Auth0 scopes and
API Gateway routes, runtime composition, candidate-rights export/deletion participation, migration-image and
restore-manifest composition (D3-014, D3-015), and any deployment. Live ATS effects
stay disabled until D3-012 approval; see the
[Phase 3 register](../../../docs/product/delivery/phase-3-application-preparation.md).

## Automatic fills from Profile facts

`FACT_FIELD_MAP` in `src/packet-source.ts` is the owner-approved convention (2026-09-19): 26 exact
`kind/key` rows from `identity`, `employment`, `education`, and `preference` facts to application fields. A field
is filled only from exactly one confirmed, currently usable fact whose value fits the field's type; competing
facts choose none, and the candidate's own entry wins. Restricted answers, narrative questions, and documents are
never mapped. Add a row only after the owner approves it and a test pins it.

## Finding a job's application

`search` takes an optional `jobId`. The result is this candidate's applications for that job, newest first. The web
workspace uses `limit: 1` to reopen the live application, treating a cancelled newest one as "none" because a
cancelled application may be restarted.

## Selected saved answers (default off)

Explicit `vaultSelections` require an observed form, exact answer revision/context, question hash
and candidate meaning confirmation. The private Profile port never substitutes a newer answer.
Packet fields bind a closed `vaultReference` in the content hash and always require review.
Profile-owned metadata admission locks run in the same Applications SQL transaction at approval,
start, dispatch, generation claim/recovery and final preparation completion. Correction, deletion
or expiry refuses the old selection with `vault_answer_changed` (preparation uses
`bindings_changed`). Missing admission capability fails closed; no KMS call occurs under these locks.
Migration `0006_vault_approval_binding.sql` adds the reason to the existing closed approval constraint.
Strict-reader rollout and candidate review UI precede activation; no live ATS executor is enabled.

## One-off document material persistence guard (ADR-038 / D3-064)

Document fields in v1 packets and account-export packet projections accept only unresolved nulls
or canonical SHA-256 artifact digests. Applications also requires each non-null document field to
match its packet's corresponding resume/cover-letter binding. The AI helper refuses to turn a
cover-letter result into a persisted proposal, including under an ordinary answer field name.
Candidate-authored non-document answers retain their separate policy.

Migration `0007_document_field_hashes.sql` validates all existing packet rows and adds the same
exact-binding SQL guard. This tightens previously accepted document values: an older packet with
material text cannot pass the new reader contracts or migration. Inventory and explicitly resolve
incompatible legacy data before rollout; do not rewrite immutable packet/history rows silently,
waive validation, or treat encryption as compliance with the no-content persistence policy. Apply
and verify the owner migration before deploying new writers. Rolling code back does not remove
this forward-only constraint; older writers that persist document text remain incompatible.
Deletion continues through existing owner-scoped candidate-rights participation; no new relation
or content backfill is introduced. Restore and deletion-replay validators require the exact current
61-migration manifest, preserving refusal of older boundaries.

These guards are a first enforcement layer. Temporary-memory storage, the absolute 1,800-second
lifetime, expiry/review/submission admission, no-store transport and provider approval remain
D3-064 work. Existing generated draft/S3/provider-slot paths cannot be activated under ADR-038.

## Original temporary-material packet admission (source only)

The trusted producer can attach at most one cover-letter and one tailored-resume scalar reference
through the owner port. Closed metadata binds generation ID, owner/application, revision, content
hash, original completion and fixed 1,800,000 ms deadline. The packet hash includes these bindings;
legacy absent/empty references keep their previous hash. Public API and portable export projections
omit internal owner/application reference fields. No public preparation request accepts references.
Ordinary packet edits carry existing bindings; replacing a hash requires replacement authority.
A descendant revision keeps the original generation deadline. Native edit-authority issuance remains
unimplemented; this port does not make an arbitrary caller a trusted generator.

Approval expires at the earliest original deadline or the existing approval-age cap. Approval,
automated/manual attempt start and queued dispatch compare exact current owner memory metadata and
check time again at admission. The Gateway never recomputes tailoring or recovers a saved cover
letter for a packet carrying temporary bindings. Missing owner capability/outage is unavailable;
lost memory or a different generation requires fresh preparation and review. SQL 0008 independently
checks its clock for new approval/start/dispatch authority, prevents omitted/renewed bindings, and
supports the new invalidation reasons. Expiry does not clear confirmed/ambiguous submission evidence
or authorize redispatch. Submission settlement and late takeover remain possible after expiry.

Apply Applications `0008_temporary_material_bindings.sql` and the exact current restore manifest
before these consumers. It adds one non-content JSON column, validated constraints and three
triggers to existing relations; no backfill timestamps, new relation or generated content. Deploy
all strict readers and Gateway/worker consumers before enabling a producer: older private packet
readers cannot verify a hash containing the new reference, and older strict API consumers reject
the optional property. Rollback can disable production but cannot restore an older reader for
new-bound packets. Existing packets remain readable by the updated consumer.

This checkpoint has no activated producer or ATS executor. Temporary content transport, preview/
file routing, original actor integration, native descendant authority, resume production, client
idle/logout/cancel/submission cleanup, renderer/worker drain and approved provider retention still
belong to D3-064. Legacy saved-draft/provider-slot and re-tailoring paths cannot be activated under
ADR-038. Scalar availability is an admission check, not an ATS content lease or all-copy cleanup.

## Temporary cover-letter reads (2026-10-05, source-only)

Applications accepts a narrow owned memory availability/preview/file port. Packets carrying
cover-letter temporary references use this port exclusively; reads never fall back to saved
drafts. References, content hashes, generation/version, packet identity, terminal state and
the original deadline are checked before/after asynchronous work. No SQL lock spans rendering.
A final owner-scoped SQL read follows the availability recheck, then a synchronous live memory
lease guards the response through HTTP serialization. Failed reads clear returned paragraphs
or file content. Bound temporary resumes refuse legacy re-tailoring; their typed temporary
reader is still required. Original/unbound reads retain their existing behavior.

Ready temporary cover-letter preview/file responses add public seven-scalar `temporaryMaterial`
metadata, without owner/application identifiers or lease callbacks. Upgrade strict consumers
before enabling any producer. No migration or durable response body is introduced.
Native session transport, original actor composition, native edit authority, idle/client cleanup,
cancel/confirmed-submission owner disposal, ATS handoff and D3-012 provider approval remain gates.
These point-in-time reads and transport guards do not certify atomic concurrent cancellation,
all-copy purge, remote settlement, socket delivery or a frozen Lambda's physical memory expiry.

The synchronous memory guard is availability authority, not a held borrowed content lease.
Bounded outgoing native content leases and all-copy disposal remain activation requirements.

## Held reads and terminal disposal (2026-10-05, source-only)

The owned cover-letter read returns a held-copy revalidation/release capability and abort signal.
Applications retains the lease through final state/deadline checks and HTTP completion. Known revoked
leases refuse before cleared-body validation. Public bodies remain unchanged; private callbacks and
signals are never serialized. Cancellation, confirmed result and submitted reconciliation request
owner scope disposal after the owning SQL commit, including on replay. Missing/failed acknowledgement
returns availability failure while retaining terminal evidence and duplicate guards; it never rolls
back cancellation/confirmation or issues another submission. Ambiguous outcomes keep their evidence.

Production still composes no temporary actor/host/reader. Compatible private adapters are required
before activation; local disposal is not cross-process/provider settlement or physical all-copy purge.

`authorizeNativeMaterialRead` is a private owning scalar read after authenticated subject-to-owner
resolution. It checks current application/packet ownership, terminal state, exact original
material/hash, expiry and cancellation before returning only packet ID/hash and scalar reference.
Native transport repeats it before sending. This is an injected in-process port, not an enabled
remote RPC, SQL lease or content reader; private authentication/composition remains unfinished.

`temporaryMaterialAuthorization` exposes only current packet ID/hash and public original material
metadata after normal owner resolution. The independent `nativeReadAuthorizationsEnabled` flag
defaults off; the capability does not call memory, rendering, model or object ports and does not
claim physical availability, approval or deadline renewal. Native transport rechecks it before
sending; other private launch/control adapters remain unfinished.

Native resume delivery now requires migration `0011_native_resume_execution_receipts` before the
new store. Publication atomically retains the original named numeric execution ARN or an explicit
no-source result. Legacy/null outcomes remain unknown. Private recovery can scan at most 25
scalar receipts for an exact version with event-ID keyset pagination, independently of candidate
activity; cycle full passes so late receipts are revisited. This reader does not reconcile AWS
state or authorize replacement work. Candidate deletion retains the existing outbox deletion path.
