# Development serverless workload recovery evidence

Date: 2026-08-07
Delivery: D0-016 / SR-005 / SR-007
Environment: isolated development in `us-east-2`
Status: Public/authenticated workload and ownership isolation pass; terminal-outbox recovery and corrected workflow release remain required

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

## Required recovery sequence

1. Merge the locally verified recovery/conformance source.
2. From exact merged `main`, plan the identifier-free 29-record post-cutover development drain.
3. Obtain explicit product-owner authorization for that exact context checksum.
4. Run one bounded retained Temporal worker, prove zero pending/open work, and return ECS to zero
   tasks without retargeting or deleting records.
5. Publish the current merged workflow artifacts to development.
6. Generate and independently review the exact 13-update/one-gate workflow release plan.
7. Obtain explicit authorization for its checksum and apply only that saved plan.
8. Repeat persistence, durable completion, the fixed workload, zero-work inspection, aggregate AWS
   measurement, and refresh-backed zero drift.

Development cutover acceptance remains open until all eight steps pass.
