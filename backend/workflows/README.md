# Durable Workflows

`native-application-preparation-lambda.ts` provides the dedicated native activity composition.
`NATIVE_APPLICATION_PREPARATION_ENABLED` defaults off; the separate launch flag permits fresh
reservation/dispatch while recovery needs only the overall switch. The managed secret, exact
numeric native launcher and existing packet protection/key ring are mandatory; legacy object/
provider settings refuse. Build its separate unpublished artifact with
`pnpm --filter @ai-job-apply/workflows build:lambda:native-preparation`.
See [runtime evidence](../../docs/product/delivery/evidence/d3-native-preparation-runtime-2026-10-06.md).

`application-preparation-native.ts` supplies a default-off preparation port for one original
native generation. It uses owner evidence and a canonical memory-only request digest, reserves
one document, issues one dispatch grant and calls the private launcher once. Recovery only reads
the exact original admitted scalar receipt into Applications completion. It has no provider-object,
model or launch-on-replay path. Managed runtime selection and activation remain pending.
See [local flow evidence](../../docs/product/delivery/evidence/d3-native-preparation-flow-2026-10-06.md).

The private native bootstrap now returns the original Documents version alongside the eight
Applications approval/context scalars, and checks that version again before replying. This private
shape requires a matching numeric receiver/image rollout. See
[version evidence](../../docs/product/delivery/evidence/d3-native-document-version-2026-10-06.md).

Private native owner RPC additionally reads the original claimed preparation's approval/context
through Applications and checks Documents' exact original work expiry. The strict eight-scalar
reply grants no renewal or work creation capability. See [bootstrap evidence](../../docs/product/delivery/evidence/d3-native-approved-bootstrap-2026-10-06.md).

Private native owner RPC source now connects task authentication before lazy owner access,
original reviewed evidence/consent, owning admission and scalar work/completion. It defaults off,
requires a numeric receiver and explicit original task deployment, and never accepts standalone
scalar requests as a fallback. Proof headers are ephemeral and never enter owner adapters or
responses. See [configuration and local evidence](../../docs/product/delivery/evidence/d3-native-owner-rpc-2026-10-06.md).
Native image/bootstrap/IAM/routing/managed/provider/client acceptance still gates activation.


This directory contains durable workflow definitions for multi-step processes that must survive crashes, deploys, provider outages, and long user waits.

## Planned subfolders

- `applications/` — Prepare, inspect, review, approve, submit, and confirm.
- `job-ingestion/` — Normalize, deduplicate, verify, publish, and expire.
- `documents/` — Parse, tailor, validate, render, and verify.
- `notifications/` — Schedule, route, retry, and reconcile delivery.
- `integrations/` — OAuth sync, cursors, webhook reconciliation, and disconnect.
- `privacy/` — Export, revoke, delete, and subprocessor propagation.
- `billing/` — Webhook handling, reconciliation, and entitlement recovery.
- `tests/` — Replay, timeout, cancellation, compensation, and idempotency tests.

Workflow code orchestrates deterministic state transitions; external I/O belongs in retryable activities/workers.

## Phase 0 implementation

The first workflow calculates profile readiness after an idempotent preference update. Its
deployed Lambda durable implementation uses an immutable definition version, exact numeric
function targets, identifier-only inputs, named bounded retries, and a private activity Lambda for
PostgreSQL access. SQS nudges plus bounded reconciliation recover the transaction-to-dispatch gap.

Local development uses `src/local-runtime.ts`, a development-only adapter around the same outbox,
durable definition, and activity contracts. It does not add another production workflow engine or
require a local cloud service.

The profile-readiness workflow has no human-review callback or reversible external effect. Callback
success/expiry is therefore tested with a conformance-only fixture; production callback handling
will be added only with an application final-review workflow.

## D1 source-neutral ingestion packet

`ingestion-durable.ts` and `ingestion-lambda.ts` provide an identifier-only durable orchestrator,
database activity, disabled schedule coordinator, SQS starter, and terminal recovery handler. The
workflow loads Jobs-owned state on every activity boundary; its persisted workflow input contains
only a dispatch UUID, schedule-derived execution digest, definition version, and bounded recovery
generation. Activity and terminal results expose only fixed statuses and aggregate counts.
The generated-synthetic configuration digest binds exact source ID `synthetic-foundation-v1`,
adapter version `synthetic-ingestion-v1`, provider,
provenance, observation bound, and synthetic seed; it contains no candidate or provider payload.
The activity binds its Lambda invocation context to the dispatch's persisted numeric version. The
terminal handler accepts the official EventBridge envelope for any retained numeric version of the
exact ingestion function, then binds account, Region, timestamps, function version, durable name,
opaque execution ID, and stored dispatch before it may create a current-version recovery.

The coordinator and activity share a Jobs-backed, exact source/adapter/config execution gate. A
persisted moderation pause prevents new schedule/resume work, fails closed before an attempt or
poll, and is rechecked around catalog writes. Terminal status reconciliation remains active while
the source is paused. The gate has no resume operation and does not claim cancellation of a catalog
write that was already issued when the pause committed.

The runtime composes the generated-synthetic source plus an optional bounded list of exact
Greenhouse, Lever, and Ashby company configurations. Each provider gets its own adapter instance,
configuration digest, durable coordinator, enable flag, and persisted pause identity while sharing
the identifier-only schedule/queue transport. Configuration accepts no arbitrary base URL or
credential. Provider execution requires explicit provider authority, and Terraform requires
private NAT egress before that authority can be enabled.

The production artifact and Terraform composition remain dark by default. Deployment,
environment-wide runtime activation, schedule/queue mapping, provider authority, and each source's
enable flag are ordered independent gates. Repository environment defaults supply an empty provider
list and enable none of them.

The same exact durable and activity artifacts also contain one operator-only Phase 1 assurance
contract. A strict generated-synthetic input, named from a reviewed run UUID, invokes the fixed
`synthetic-d1-provider-fault-v1` adapter at attempt 1, waits durably for one second, and invokes it
again at attempt 2. The first call returns only `source_unavailable`; the second returns an empty
success. This path is absent from the schedulable source registry, performs no database or provider
I/O, produces no catalog rows, and has no EventBridge, SQS, API, or resource-based trigger. It is
reachable only through an explicitly authorized direct IAM invocation of an exact numeric durable
version while the guarded acceptance operator proves every normal/provider gate remains off.

## D3 requested cover-letter preparation (local implementation)

`application-preparation-evidence.ts` supplies a default-off private owner-read composition:
active-candidate lease, owned application binding, active Jobs posting and Profile facts. Restricted
facts are excluded; Profile's shared graph projection snapshots values/provenance without audit
timestamps. The full posting is snapshotted for context hashing, while AI SDK bounds the prompt.
It rechecks the kill switch and posting expiry before returning, and failures reveal no private
owner diagnostics. Twenty-one offline cases and three real PostgreSQL cases verify ownership,
quarantine, freshness and minimization. The integration uses each owner's supported database client
and a separate lease pool, all capped at one connection, avoiding codec mismatch and nested-pool
deadlock. Authentication is simulated; no S3/provider or deployed read evidence is claimed.
The source factory is not composed into a production handler yet; privacy/runtime gates remain.

Candidate document cleanup now refuses inventoried cover-letter reservations without an injected
private writer/provider quiescence authority, including pending SQL rows with empty S3 prefixes.
Observed generation slots/final draft keys also require positive proof before prefix cleanup.
Missing/false/malformed/failed/stalled proof returns a fixed error, never inferred success from
local cancellation or elapsed time. The source runtime supplies no proof port yet, so generation
cleanup is default-denied; ordinary resume-only cleanup is unchanged. Eight new offline gate tests
and six connected synthetic PostgreSQL cases pass with an explicit test-only confirmation port.
The persisted authority/drain, retention and reviewed IAM/runtime remain required before activation.

`application-preparation-durable.ts` supplies an identifier-only durable factory, an exact
numeric private activity target, named five-attempt retries and bounded failure compensation.
The private activity projects fixed outcomes; it never returns candidate text. A completed
workflow means processing finished, not that generation succeeded: the Applications-owned
preparation operation is authoritative. Failed compensation still needs independently bound
terminal reconciliation.

The 18 SDK unit tests cover replay, bounded retries, compensation and strict payload contracts.
Six real PostgreSQL integration tests connect atomic acceptance, the Documents generator,
grounding, verified PDF/DOCX, immutable draft recovery and mandatory-review packet finalization.
They use synthetic owner evidence, an offline model and in-memory object transport, not live
Profile/Jobs APIs, S3 or OpenAI. Connected tests retain native timers because SDK skipped time
also replaces PostgreSQL pool deadlines. Fixture cleanup uses the owner privacy boundaries,
including when fixture preparation fails.

`application-preparation-dispatch.ts` adds the source-only owned starter; its injected AWS
adapter invokes the stored numeric version with canonical identifier-only bytes and a ten-second
abort signal. Twelve offline tests verify strict inputs, owner-event identity, version pinning,
ambiguous-start retries, exact receipts and fixed errors. Real Applications PostgreSQL tests
verify the underlying leased claims and terminal settlement. No SDK client is bootstrapped here.

`application-preparation-recovery.ts` supplies bounded reconciliation and terminal handlers.
New dispatch defaults off while accepted-work recovery continues. Fair sixty-second PostgreSQL
claims prevent duplicate/oldest-row starvation. Status reads explicitly disable execution data;
strict terminal envelopes are nudges, independently confirmed by AWS metadata before settlement.
The injected SDK/SQS ports use ten-second abort signals; reconciliation stops issuing additional
AWS reads or queue sends after fifty seconds. Thirty-one recovery/SQS/SDK tests are offline. Two additional connected
PostgreSQL cases verify lost-ACK recovery without another model execution and duplicate terminal
settlement with one audit. No SDK clients or environment handlers are bootstrapped here.

These factories are not a deployed or complete runtime. Cloud bootstrap/artifacts, dispatch
scheduling/SQS mappings, terminal composition and production provider/read ports remain unfinished. Under
[ADR-016](../../docs/adr/016-scale-to-zero-application-runtime.md), the private database activity
must use an isolated provider port: no direct internet model call or provider credential in the
database runtime. Provider activity must receive minimum owned object references outside the VPC
and have no database credentials. All activation and accountable review gates remain separate.

## D2 isolated deletion recovery

The source-only D3 cover-letter extension of `candidate-rights-aws.ts` fences observed fixed
generation request/dispatch/result slots with current delete markers before permanent historical
deletion. The fence identity must be current, older versions/markers must be proven gone, then
the fences can be removed and full prefix absence checked. Exact account inventory cleanup
cannot bypass this ordering. Errors leave current fences for a safe retry; ordinary resume
keys keep their existing path. Eleven offline versioned-S3 tests probe conditional late writes
after every permanent removal, multi-page/multi-batch history, failed acknowledgements, missing
fences, surviving history, retries, foreign-owner preservation and forbidden late creation.
Six connected synthetic PostgreSQL deletion/restore cases pass, including row/quarantine retention
on incomplete fenced cleanup and successful retry, using offline object transport.

This is not deployed. [Proposed ADR-037](../../docs/adr/037-precreated-cover-letter-provider-slots.md)
requires separately reviewed marker-creation IAM (`s3:DeleteObject`, absent from the current
documents maintenance grant), provider creation prohibition, remote-dispatch quiescence and
transient retention. No Terraform or guard edit, permission apply or provider activation is included.

Account deletion's document-object activity removes recorded exact keys and every version and
delete marker under the owned document IDs' `quarantine/<id>/` and `normalized/<id>/` prefixes.
This includes older parser outputs absent from the Documents row's latest normalized key. All
document IDs are validated before S3 I/O; malformed listings and repeated pagination refuse.
A batch-wide second inventory must be empty before owner-row deletion can proceed. Incomplete
cleanup leaves the account quarantined with its Documents inventory intact for retry. Neighboring
document prefixes are not purged. This reuses ADR-034's resume purge without API or IAM changes;
the [D3-031 record](../../docs/product/delivery/phase-3-application-preparation.md#task-register)
distinguishes local verification from release and deployed acceptance.

`candidate-deletion-restore-lambda.ts` is a temporary operator-only restore executor, not a durable
application workflow or scheduled service. The exact version/configuration binds a verified private
PITR copy; a fresh pool resolves only that target from the fixed source secret. Complete retained
marker, historical policy, owner-collision and document-absence checks precede all restored writes.
It reconciles the seven current owners through their deletion boundaries in one transaction and
returns schema-validated aggregates. Its cloud role cannot mutate S3 documents, recovery markers,
retention, or Auth0. No public API/event contract or SQL migration is introduced.

Use `build:lambda:deletion-restore` to build and `replay:candidate-deletions -Help` for the maintained
operator. The old direct-URL/per-marker replay path is removed. See the
[existing recovery runbook](../../infrastructure/runbooks/restore/candidate-deletion-recovery-replay.md)
and [Phase 2 record](../../docs/product/delivery/phase-2-extension-and-community.md#d2-038--isolated-deletion-recovery)
for exact implementation, deployment and acceptance status. Local tests do not imply IAM activation
or cloud replay acceptance.

`application-preparation-documents.ts` now supplies a default-off source composition from the
existing Applications activity to owned evidence, controlled initialization, one isolated Invoke
and original draft recovery. Recovery receives no initializer/Invoke capability; original consent
is detached and never refreshed. An independent candidate-lease pool avoids nested-query deadlock
while preserving each owner's supported codecs. 39 focused and seven real PostgreSQL cases pass,
including durable SDK execution and consent-expired recovery without another dispatch. See
[local evidence](../../docs/product/delivery/evidence/d3-private-preparation-port-2026-10-04.md).
Native bootstrap/artifacts, IAM/scheduling, retention/drain and accountable/deployed gates remain;
no production activity or provider is activated by this factory.

Native `application-preparation-lambda.ts` lazily binds the existing strict metadata contract to
managed database credentials, qualified numeric provider Invoke and native owner clients.
It defaults off, refuses warm configuration drift and gives separate bounded pools to candidate
leases, owner reads and Documents work. `build:lambda:preparation` emits a separate local
private-activity artifact family; both emitted port/activity checks exclude provider implementations.
See [source evidence](../../docs/product/delivery/evidence/d3-preparation-activity-bootstrap-2026-10-04.md).
Nothing is deployed or activated; caller IAM, native durable/dispatcher/recovery bootstrap,
retention/drain and accountable/deployed acceptance remain.

`application-preparation-durable-lambda.ts` qualifies numeric same-account target/activity
configuration and activation outside deterministic SDK workflow code. Warm drift refuses
retargeting; private/provider settings refuse before SDK state handling. The existing metadata
contracts and retry/compensation definitions remain unchanged. `build:lambda:preparation-durable`
creates a separate local orchestration-only family. See [D3-069 source evidence](../../docs/product/delivery/evidence/d3-preparation-durable-bootstrap-2026-10-04.md).
Native dispatcher/recovery/release, IAM/scheduling, retention/drain and accountable/deployed
acceptance remain; nothing is deployed or activated.

`application-preparation-starter-lambda.ts` supplies a default-off native SQS entrypoint with
qualified managed-secret setup, one Applications SQL connection and one-attempt durable Invoke.
Original ledger bindings survive retries; the compact retained-version list permits only exact
versions of the same durable function and never retargets accepted work. Warm drift refuses.
`build:lambda:preparation-starter` creates a separate local artifact; no deployment is implied.
See [D3-070 evidence](../../docs/product/delivery/evidence/d3-preparation-starter-bootstrap-2026-10-04.md).
Native terminal recovery, release/IAM/scheduling/retention/drain and accountable acceptance remain.

`application-preparation-recovery-lambda.ts` exports separate terminal and scheduled entrypoints
from a default-off native artifact. Terminal configuration has no queue/nudge settings; scheduled
recovery keeps original metadata settlement active with new nudges disabled. Exact retained
versions and strict envelopes precede managed-secret setup; metadata reads exclude execution data.
No durable Invoke, model/private activity or document writer is composed. The pure pending-error
module preserves the existing starter export. `build:lambda:preparation-recovery` packages both
handlers locally; their separate caller/metadata/queue IAM and scheduling still require release.
See [D3-071 evidence](../../docs/product/delivery/evidence/d3-preparation-recovery-bootstrap-2026-10-04.md).
Nothing is deployed or activated; retention/drain and accountable/deployed acceptance remain.

Candidate export can enrich ready cover letters with verified saved paragraphs/review metadata
through the Documents owner. Pending entries and legacy exports remain metadata-only. Native
privacy activity composes the separate read pool only for exact `COVER_LETTER_EXPORT_ENABLED=true`
and available document KMS configuration. Withdrawal refuses subsequent reads; no model/provider
or document write is composed. Updated export readers must precede producer activation because
old strict validators reject the new optional fields. See [D3-072 evidence](../../docs/product/delivery/evidence/d3-cover-letter-export-content-2026-10-04.md).
No deployment/activation is implied; read IAM, release, privacy and deployed acceptance remain.

Selected saved-answer preparation binds its original base packet's reference metadata and checks
it before generation/recovery and final packet creation. The native actor composes a KMS-free
Profile metadata reader and its fixed admission lock method, running locks inside the Applications
transaction. No saved-answer values or references are sent to Documents generation/recovery.
This source composition requires reviewed native deployment; nothing is activated here.

The default-off private native material launcher now composes owning metadata admission and
claim/capture using one native-codec SQL pool and a managed database secret. Its strict private
sender uses signed fixed-region numeric Lambda invocation; recovery remains independent of
new-launch shutdown. Build the unpublished artifact with `pnpm build:lambda:native-launch`
from this workspace. Sender IAM, native image/private adapters/routing/task conformance remain
release gates. See [evidence](../../docs/product/delivery/evidence/d3-native-launch-control-2026-10-06.md).


The private `native-material-task-event-lambda` receives bounded ECS task-state hints and calls
only positive original launch recovery. It defaults off, pins its numeric receiver/target and
original deployment metadata, and cannot launch, stop, settle work or certify retirement.
Build an unpublished source-bound artifact with `ARTIFACT_SOURCE_SHA=<committed SHA>` and
`pnpm --filter @ai-job-apply/workflows build:lambda:native-task-event`. Reviewed event routing,
IAM, original-version retention, retries/DLQ and managed task conformance remain gates; see
[local evidence](../../docs/product/delivery/evidence/d3-native-task-event-recovery-2026-10-06.md).

The default-off `createNativeOwnedCoverLetterEvidenceSource` wraps existing Applications/Jobs/
Profile owner evidence with exact original native admission checks before and after reads and
fixed original job/fact context comparison. It is source-only; authenticated private task
transport and managed bootstrap remain gates. See [evidence](../../docs/product/delivery/evidence/d3-native-evidence-admission-2026-10-06.md).


`pnpm --filter @ai-job-apply/workflows build:lambda:native-owner-rpc` builds the source-bound
private receiver artifact from clean committed source. Its default-off bundled refusal check
performs no secret, SQL or cloud access. This does not publish, deploy or enable the receiver.

`native-resume-route-lifecycle.ts` adds a default-off private durable component for original
route capture, one DNS creation attempt, propagated readiness, owner attachment and exact cleanup.
It uses the existing SDK's checkpoint-before-execution semantics plus disabled retries for both
DNS writes; all clock/I/O decisions are checkpointed. Unknown acknowledgements stay unresolved.
It requires one owning allocation-bound execution and supplied private owner ports. Preparation
Lambda composition, longer execution timeout and terminal reconciliation are still required; see
[local lifecycle evidence](../../docs/product/delivery/evidence/d3-native-resume-route-lifecycle-2026-10-07.md).

The preparation control and durable entrypoint now compose those owner ports behind separate
route-owner, lifecycle and creation switches (all default off). Attachment interruptions remain
unresolved while cleanup continues. Release timeout/IAM/configuration and terminal reconciliation
are still required. See [owner integration evidence](../../docs/product/delivery/evidence/d3-native-resume-route-owner-2026-10-07.md)
for configuration, local verification and remaining managed acceptance.


Cover-letter route groundwork uses `native-material-route-owner.ts` to pin one original work
binding and ready reference. It checks current owning admission before/after address capture;
positive original retirement remains observable after admission is sealed. The material lifecycle
uses the shared `native-route-lifecycle.ts` implementation with `material-route.*` checkpoints;
resume retains its existing `resume-route.*` names. Both are default-off and retain uncertain DNS
writes/attachments for reconciliation rather than retrying mutations. Material private invocation,
one-original-execution dispatch, packet attachment and deployment/IAM composition remain unwired.


`native-material-launch-lambda.ts` now multiplexes the new closed `native-material-route.v1`
private envelope to `native-material-route-control-lambda.ts`. Existing launch/recovery inputs
are unchanged. The route path pins managed database/task/DNS configuration and needs its own
`NATIVE_MATERIAL_ROUTE_CONTROL_ENABLED` switch as well as control enablement. It reuses the
original numeric deployment and owning admission/address checks, without fresh launch, packet
attachment or DNS mutation. Its sender has only scalar Lambda invocation capability. Preparation
dispatch still needs to bind one original route execution and attach after propagation.
