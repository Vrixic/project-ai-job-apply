# Development serverless workload recovery evidence

Date: 2026-08-07
Delivery: D0-016 / SR-005 / SR-007
Environment: isolated development in `us-east-2`
Status: Development scale-to-zero cutover accepted; obsolete-runtime retirement remains separately gated

## Accepted browser evidence

After the merged gateway cold-start retry release and exact two-update development alias release,
the product owner completed the routed Lambda conformance sequence:

- authenticated preference persistence completed successfully;
- the readiness workflow reached `succeeded`;
- a second account received only the sanitized non-disclosing cross-user isolation pass; and
- the fixed Phase 0 workload completed from `2026-08-08T00:27:34.813Z` through
  `2026-08-08T00:28:08.188Z`.

The accepted workload ran 500 public requests with zero failures, 25 workflow attempts with 25
durable successes, and one matching idempotent replay. Liveness/readiness `p95` were 80/74 ms,
write `p95` was 153 ms, and durable propagation `p95` was 783 ms. Only aggregate results were
retained.

## Capacity correction

The first workload attempt used the staging profile's concurrency of five against development's
reviewed gateway reserved-concurrency ceiling of two. CloudWatch recorded Lambda throttling and the
public batch failed before any workload workflow writes. The local-only conformance tool now keeps
the same 500-request/25-workflow profile while selecting concurrency two for development and five
for staging. It remains disabled unless the launcher explicitly selects one isolated environment
in development mode, and it remains unavailable for dark-Lambda conformance.

Focused web tests and type checking pass. The discarded attempt is outside the accepted workload
window, and the gateway throttle alarm returned to `OK` before the accepted replay.

## Zero-work acceptance defect

The post-workload verifier started one bounded read-only database-inspection Fargate task. The task
exited `0`, emitted one identifier-free version-one result, retained no event identifiers, and
reported 29 pending outbox rows. No service capacity or persistent infrastructure changed, but the
temporary task is an AWS control-plane mutation and is recorded explicitly.

Aggregate corroboration found:

- the source queue and both dead-letter queues empty;
- every development alarm `OK`;
- 26 fixed-message `durable outbox start accepted` records during the workload window;
- five informational reconciler summaries and no inspected error-level workflow records; and
- no raw identity, token, preference, operation identifier, or event identifier retained.

The accepted input workflows were therefore started and acknowledged correctly. The 29 remaining
rows match terminal `profile.readiness.calculated.v1` results created by the older development
workflow artifact deployed on 2026-08-04. That artifact predates the staging-proven correction that
atomically retains these no-subscriber terminal events as already acknowledged. Development has
reproduced the same historical terminal-outbox defect previously recovered in staging.

The aggregate workload inspector failed closed at its required zero-pending-outbox boundary. It did
not claim zero drift or complete SR-007.

## Local recovery source

The source now:

- exposes the fixed workload to either isolated environment only through an explicit local-only
  launcher switch;
- matches workload concurrency to each environment's reviewed gateway ceiling;
- adds `PlanWorkflowRelease` to the development runtime wrapper, delegating to the existing exact
  13-update/one-propagation-gate live workflow-release guard; and
- generalizes the staging-proven checksum-gated legacy Temporal drain into an environment-aware
  core with a fixed development wrapper and account-local state, cluster, worker, secret, log,
  Lambda, and context boundaries.

PowerShell parsing, wrapper help, serverless-infrastructure policy validation, five focused web
tests, and web type checking pass. No legacy row was acknowledged, no workflow artifact was
published, no Lambda alias or route changed, and no drain context was created by this source work.

After PR #177 merged, the first exact-main development drain preflight failed closed during its
initial live-runtime reads, before starting the outbox-inspection task or writing a review context.
PowerShell variable names are case-insensitive; the generalized core's local `$environment`
worker-settings dictionary had overwritten the top-level `$Environment` selector, so the gateway
alias lookup received a dictionary and AWS rejected it. The local value is now named
`$workerEnvironment`, and policy validation forbids reintroducing the case-insensitive shadow.
No inspection task, drain worker, product-record transition, or persistent AWS change occurred.

## Reviewed recovery and release execution

The product owner authorized the identifier-free drain plan with checksum
`10c51c74f14c2fec661b92b8bf57143eee787b4a80150ff95e03e837ecca7679`.
The bounded execution transitioned exactly 29 reviewed terminal rows, left zero outbox rows and
zero running Temporal workflows, stopped its one temporary retained worker, emitted one startup
and zero worker-error records, removed its ignored context, and changed no public traffic, trigger,
ECS service capacity, or event target.

GitHub Actions then reproducibly built, audited, and published three immutable workflow artifacts
from merged commit `c4e72526eb6ddd77aa13067438074398899a02f6` with versioned KMS-encrypted
objects, manifests, checksums, and CycloneDX SBOMs. The independently inspected release plan
contained only 13 in-place workflow updates and replacement of the Terraform IAM-propagation gate.
The product owner authorized checksum
`eae2a092aab030d08dc1da551af4bec5bc74f38366e5f97d51612b990d3ed8f0`; apply and
the automatic refreshed verifier passed with Lambda durable dispatch, enabled triggers, idle ECS,
and zero drift. An initial invocation through the historical cutover-only operator failed before
mutation; the existing runtime-maintenance operator accepted and applied the unchanged reviewed
plan.

## Corrected-artifact browser replay

The product owner repeated authenticated saving and cross-user isolation against the corrected
development release. The fixed workload ran from `2026-08-08T02:16:04.990Z` through
`2026-08-08T02:16:41.000Z`: all 500 public probes passed, all 25 workflows succeeded, and the
idempotent replay matched. Liveness/readiness `p95` were 81/73 ms, write `p95` was 154 ms, and
workflow propagation `p95` was 807 ms.

Before aggregate AWS corroboration, the shared inspector failed closed locally because its
development selector still invoked the initial-cutover operator, which cannot accept a guarded
post-cutover maintenance plan. The selector now targets the existing development runtime-maintenance
operator and policy validation rejects regression. No AWS inspection or mutation occurred from
that failed local selection.

## Aggregate AWS acceptance

After PR #179 merged, the corrected read-only inspector replayed the exact accepted workload
window against the applied immutable release. It observed 603 API requests, including at least the
500 public probes and 100 expected unauthorized probes, with zero API `5xx`. The workflow Lambda
set recorded 666 invocations with zero errors and zero throttles. Maximum database CPU was 5.14%
with at most five connections; event-queue age and visible depth, both dead-letter queues, and all
other accepted work boundaries remained zero.

The inspector found 1,046 aggregate application log events with zero operational-error matches and
zero forbidden privacy-pattern matches. Both retained ECS services remained idle, all ten runtime
alarms were `OK`, dispatch remained `lambda_durable`, triggers remained enabled, and the fresh
Terraform verifier returned zero drift.

The companion read-only cost status also passed the temporary-caller, runtime, budget, and export
boundaries. Cost Explorer reported an estimated month-to-date unblended total of `$21.1151` across
13 nonzero services, with one AWS Budget and one CUR 2.0 Data Export. This snapshot is evidence for
later SR-010 reconciliation; it is not a claim that every charge has posted or that the final
steady-state cost baseline is complete.

## Required recovery sequence

All development cutover recovery and acceptance steps are complete. D0-016 continues with a
separately recorded rollback-window expiry, checksum-reviewed obsolete-runtime retirement,
Temporal/provider cleanup, repository cleanup, final two-environment proof, and cost reconciliation.

Development cutover acceptance is complete; this does not authorize destructive retirement.
