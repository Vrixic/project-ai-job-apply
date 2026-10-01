# Durable Workflows

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

## D2 isolated deletion recovery

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
