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

## Immutable publication and historical drain

The merged correction at source commit `244806cbc5d28a2cb42b80e6b2f070498460b8f8` passed the
protected staging publication workflow. All three workflow ZIPs passed tests, dependency audit,
reproducibility, versioned S3 publication, customer-managed KMS encryption, and independent AWS
read-back of their exact object versions and checksums. Publication changed no Lambda version,
alias, route, trigger, queue, ECS service, or product record.

The separately reviewed post-cutover legacy drain plan had SHA-256
`4c5456165043efd78fdbf28097c1e7147a7f5a37018ac3bd69f728c6be25692c`. Its authorized execution
processed exactly the 26 zero-attempt historical records through one temporary retained worker.
The outbox and open Temporal workflow counts reached zero, the worker stopped, its aggregate logs
contained one startup and zero errors, and the review context was removed. The accepted JWT/Lambda
route, enabled replacement triggers, ECS services at `0/0/0`, dispatch targets, and persistent
infrastructure remained unchanged. No record was retargeted or deleted.

## Guarded release and recovery

The staging runtime planner now exposes an explicit post-cutover workflow release mode. It permits
only the coupled live workflow boundary: 13 bounded in-place updates and the
policy-hash-keyed IAM propagation-gate replacement. It preserves the exact JWT/Lambda API route,
`lambda_durable` dispatch, all enabled workflow triggers, persistent data, secrets, gateway release,
and retained ECS at `0/0/0`. The existing staging maintenance operator independently validates the
exact address/property boundary, binds apply to clean merged `main` and an exact SHA-256, and requires
completed-runtime zero drift afterward.

Rollback is a separately planned release to the previously accepted immutable workflow artifact
set through the same exact boundary and a new checksum. It never moves an alias to `$LATEST` and
never combines artifact rollback with route, trigger, capacity, data, or legacy-record changes.

The first live-release diagnostic failed closed before returning an authorizable checksum. Its
Terraform plan correctly contained 13 in-place workflow updates plus the propagation-gate
replacement: the terminal DLQ policy was already converged and therefore a no-op, while the
terminal EventBridge rule correctly remained `ENABLED` for the live post-cutover release. The
original guard had required the release-independent queue policy to change and had reused the
dark-release `DISABLED` rule-state assertion.

The source guard now distinguishes dark and live trigger state and recognizes only the exact
13-update/one-gate live boundary. A read-only replay against the rejected diagnostic plan passes
that corrected semantic boundary with zero creates, standalone deletes, route changes, trigger
state changes, ECS-capacity changes, or AWS mutation. That diagnostic checksum is not eligible for
authorization.

After that correction merged, a fresh exact-main plan again contained the expected 13 updates and
one propagation-gate replacement, but the planner failed closed before returning a checksum. The
release-specific verifier had already required the durable template to be plan-time unknown because
the new activity Lambda's numeric version is assigned only during apply; a later generic completed-
runtime check redundantly rejected the same expected unknown. The live CloudFormation stack remains
`UPDATE_COMPLETE`, its current template is available and exact, the saved plan is unapplied, and no
AWS resource changed.

The narrow source correction permits an unknown durable template only in the already validated
workflow-release mode. That mode still proves the exact current template, restricts the stack change
to its template and computed outputs, binds every immutable desired artifact, and requires the
activity-version dependency to be explicitly unknown. After apply, completed-runtime verification
still requires the fully materialized new template and zero drift. Merge and a fresh exact-main
plan remain required; neither rejected diagnostic checksum is eligible for authorization.

## Remaining acceptance

The immutable artifact publication and exact historical drain are complete. Before SR-006 can
complete:

1. merge the activity-version-aware release guard, then generate, review, authorize, and apply a fresh
   exact-main post-cutover workflow release;
2. rerun the authenticated save, idempotent replay, two-account isolation, fixed workload, aggregate
   AWS corroboration, zero-work inspection, and zero-drift verification; and
3. prove that new successful workflows leave zero pending terminal events.

Until those gates pass, the staging replacement path is not fully re-accepted and the user should
not submit additional synthetic saves.
