# Staging terminal-outbox recovery evidence

Date: 2026-08-07
Delivery: D0-016 / SR-005 / SR-006
Environment: isolated synthetic staging in `us-east-2`

## Accepted capacity and workload boundary

The checksum-reviewed staging gateway concurrency correction is deployed at reserved concurrency
`5`. The fixed post-restoration workload then completed in 26,546 ms with:

- 500 public requests and zero failures;
- liveness `p95` 87 ms and readiness `p95` 72 ms;
- 100 expected unauthorized responses with `p95` 55 ms;
- 25 workflow attempts and 25 durable successes;
- byte-equivalent idempotent replay;
- write `p95` 180 ms; and
- durable-result propagation `p95` 810 ms.

Aggregate AWS corroboration for the bounded run found 659 gateway Lambda invocations with zero
errors or throttles, 599 API requests with zero `5xx`, all three queues empty at inspection, all 18
routed alarms `OK`, retained ECS services at `0/0/0`, database CPU below 7% with at most eight
connections, and zero aggregate error or forbidden-sensitive-pattern matches. This closes the
capacity defect recorded in the preceding restoration evidence.

## Acceptance defect

The post-run zero-work gate found 26 unpublished outbox records. Identifier-free aggregate
inspection proved that every record:

- is a terminal `profile.readiness.calculated.v1` result created by a successful durable workflow;
- retains the historical `temporal` dispatch target;
- has zero nudge and start attempts; and
- remains immediately retry eligible but is correctly ignored by the Lambda-durable reconciler.

The old Temporal worker treated this event as a terminal notification with no Phase 0 subscriber
and acknowledged it without downstream delivery. After that worker moved to idle `0/0/0`, the
database completion transaction still inserted the same event with `published_at = NULL`. Every
successful save therefore left one undispatchable terminal record and recreated a hidden dependency
on the retired runtime. The user-visible local page also became stuck after its foreground Next.js
launcher timed out; cloud workflows had completed successfully, so that local process failure is
separate from the durable outbox defect.

## Source correction

Operation completion now uses one completion timestamp and atomically records the retained terminal
event as acknowledged in the same PostgreSQL transaction. This preserves the immutable audit/event
record and the historical no-subscriber semantics without requiring Temporal merely to clear it.
The existing legacy dispatcher behavior remains available only to drain historical records.

A real PostgreSQL integration assertion now requires exactly one terminal result event, zero pending
terminal events, and a non-null acknowledgement after successful completion. Profile type checking,
nine unit tests, three real-PostgreSQL integration tests, migrations through `0002`, formatting, and
the serverless-infrastructure policy validator pass locally.

No contract, schema migration, user-data rewrite, dispatch-target rewrite, or AWS mutation is part
of the source correction.

## Guarded release and recovery

The staging runtime planner now exposes an explicit post-cutover workflow release mode. It permits
only the previously proven coupled workflow boundary: 14 bounded in-place updates and the
policy-hash-keyed IAM propagation-gate replacement. It preserves the exact JWT/Lambda API route,
`lambda_durable` dispatch, all enabled workflow triggers, persistent data, secrets, gateway release,
and retained ECS at `0/0/0`. The existing staging maintenance operator independently validates the
exact address/property boundary, binds apply to clean merged `main` and an exact SHA-256, and requires
completed-runtime zero drift afterward.

Rollback is a separately planned release to the previously accepted immutable workflow artifact
set through the same exact boundary and a new checksum. It never moves an alias to `$LATEST` and
never combines artifact rollback with route, trigger, capacity, data, or legacy-record changes.

## Remaining acceptance

This record is source/local evidence only for the correction. Before SR-006 can complete:

1. merge and publish all three workflow artifacts from exact source;
2. plan, review, authorize, and apply the exact post-cutover workflow release;
3. drain the existing 26 historical records through the separately checksum-bound legacy Temporal
   drain, without retargeting or deleting them;
4. rerun the authenticated save, idempotent replay, two-account isolation, fixed workload, aggregate
   AWS corroboration, zero-work inspection, and zero-drift verification; and
5. prove that new successful workflows leave zero pending terminal events.

Until those gates pass, the staging replacement path is not fully re-accepted and the user should
not submit additional synthetic saves.
