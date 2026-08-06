# Staging post-cutover drain and rollback preflight — 2026-08-06

## Legacy drain outcome

The product owner authorized the exact reviewed post-cutover legacy-drain checksum. The guarded
operator started one retained standalone Temporal worker against the accepted Lambda/JWT runtime.
The local command host reached its five-minute ceiling before the operator could print its normal
terminal result, so the run was treated as interrupted rather than assumed successful.

Read-back found the exact reviewed worker still running and the checksum-bound context intact. The
documented cleanup path used that same checksum, stopped exactly one owned worker, and reported:

- zero remaining outbox records;
- zero running Temporal workflows;
- one reviewed task stopped;
- the stale context removed; and
- a mandatory fresh plan before any further transition.

Independent aggregate log inspection found exactly one worker startup and zero error-level worker
records. No reviewed task remained active. The deployed validation-only conformance then passed the
public Lambda alias, JWT-protected default route, public health routes, durable workflow triggers,
idle ECS rollback resources, and health/access prerequisites. No account, resource, task, event,
operation, endpoint, secret, or candidate identifier is retained here.

The drain is accepted through the interrupted-execution recovery path. It does not claim that the
timed-out command itself returned success; the cleanup and independent read-back provide the
terminal evidence.

## Fresh runtime baseline

After terminal drain evidence, the runtime verifier reconstructed all four accepted immutable
artifacts and the pinned extension from the latest accepted maintenance baseline. Its
refresh-backed current-source plan reported:

- zero creates, updates, deletes, or replacements;
- zero pending legacy outbox records;
- zero open Temporal workflows and Lambda durable executions;
- `lambda_durable` dispatch and every durable trigger enabled;
- idle retained ECS services;
- no API-traffic or ECS-capacity change; and
- complete artifact and extension verification.

This is the required exact-current zero-drift baseline for staging rollback review. It changed no
AWS resource.

## Rollback-plan false rejection

The rollback planner passed AWS, secret-metadata, Temporal-authentication, and zero-work preflight,
then generated exactly the intended local transition: three API integration/health-route deletes,
six bounded route/gateway/trigger updates, zero creates, and zero replacements. The operator still
rejected it before checksum/context output.

Diagnosis proved that `Compare-Object` received both address arrays positionally. PowerShell
flattened those arguments during binding, causing a false mismatch even though both address sets
were byte-for-byte equal. The rejected ignored plan was quarantined locally and cannot be applied.
No rollback context was created and no AWS mutation occurred.

Source now constructs explicit delete/update address-difference arrays with named
`-ReferenceObject` and `-DifferenceObject` parameters, matching the already hardened forward
cutover validator. The repository policy requires these rollback-specific forms. An isolated
function-level replay against the rejected plan passes the complete nine-action semantic validator,
including dispatch, route, alias, mapping, and EventBridge transitions.

## Exact-main replan and summary-contract rejection

After the address-comparison correction merged, a new exact-current runtime baseline again passed
with zero drift, zero legacy or durable work, enabled replacement triggers, idle ECS, and complete
artifact verification. A fresh rollback plan then passed the corrected complete nine-action
semantic validator. It stopped before checksum/context output because backend-initialization status
lines and environment-provider cleanup objects leaked into the planner's success pipeline. Strict
mode therefore received an array instead of the one summary object that owns `Sha256`.

The generated ignored plan remains unapplied and no rollback context exists. Source now captures
backend initialization output for failure-only diagnostics and explicitly discards restoration
provider output. Repository policy makes those output-suppression boundaries mandatory so both
rollback and restoration planning return exactly one review summary. No AWS mutation occurred.

## Authorized apply baseline-binding rejection

After the summary-contract correction merged, another fresh exact-main runtime baseline passed
with zero drift and the complete accepted runtime boundary. Rollback planning produced and retained
the exact zero-create, six-update, three-delete, zero-replacement plan, returned its review checksum,
and created the checksum-bound ignored context. The product owner authorized that exact checksum.

Apply then failed closed before Terraform or AWS mutation because rollback planning's own completed
runtime verifier had refreshed the same commit-named zero-change baseline file. Terraform plan
binaries are not byte-stable across equivalent refreshes, so the context retained the checksum from
before verification while the file correctly contained the newly verified equivalent baseline.
All other context bindings and the authorized rollback-plan checksum matched. The rejected plan and
context were quarantined locally and cannot be reused.

Source now requires completed runtime verification to report the exact reviewed baseline path and
match its post-refresh file checksum. `PlanRollback` records that refreshed checksum, and
`ApplyRestore` advances the context to the refreshed restored-runtime checksum before cleanup.
Repository policy and an isolated function-level mismatch rejection guard this lifecycle. No AWS
resource, route, trigger, capacity, or data changed.

## Authorized rollback apply and API Gateway conflict

After the checksum-binding correction merged, another exact-main runtime baseline passed with zero
drift and the complete accepted runtime boundary. A fresh exact nine-action rollback plan passed,
its post-refresh baseline and transition checksums matched the ignored context, and the product
owner authorized that exact transition checksum.

Terraform completed five actions before AWS rejected deletion of the Lambda API integration with
`ConflictException`. Read-back proved the two public health routes were removed and all three
replacement triggers were disabled, while the JWT-protected default route still referenced the
Lambda integration. A refresh-backed diagnostic contained exactly four remaining actions: the
default-route, gateway function, and alias updates plus integration deletion. RDS, queues, Lambda
functions, retained ECS resources/capacity, and product data were not deleted. The combined plan was
treated as stale and was not retried.

The causal boundary is ordering rather than authorization or work backlog: API Gateway may still
report the integration in use while an in-place route update propagates, and the original combined
Terraform graph did not enforce a service-level propagation barrier before deletion.

## Checksum-authorized recovery

A separate refresh-backed recovery plan reconstructed only the five already committed actions in
the accepted serverless direction: two public health-route creates and three trigger updates, with
zero deletes or replacements. Before apply, exact upstream source, the saved checksum, the five
resource addresses, three empty queues/DLQs, zero running durable executions, and a bounded
aggregate database inspection reporting zero pending outbox rows all passed.

The product owner authorized that exact recovery checksum. Apply completed, then the full runtime
verifier reported zero drift, `lambda_durable` dispatch, enabled triggers, idle ECS, zero legacy
outbox work, and zero open Temporal workflows. Live route inventory again contained the protected
Lambda default route plus exactly two public health routes; liveness and readiness both returned
`200`. The failed rollback/context, partial diagnostic, and applied recovery plan are quarantined
under ignored local filenames and cannot be reused as active plans.

## Ordered rollback correction

Source now separates the rollback into two authorization boundaries. The first plan performs only
the two health-route deletes and six route/gateway/trigger updates while a default-off,
rollback-only Terraform input retains the Lambda integration. Its apply persists an intermediate
state and must pass a fresh zero-change plan proving the default route uses retained ECS, dispatch
and triggers are dark, ECS capacity remains zero, and the Lambda integration is unreferenced.

Only then may a second plan be generated. Its validator permits exactly one deletion—the
unreferenced Lambda integration—and requires a separate checksum authorization. Interrupted
post-apply verification can resume without replaying either saved plan. Restoration remains a third
separately reviewed direction. Terraform module tests cover the retained-integration dark boundary;
repository policy rejects the old combined validator and enforces the ordered state machine.
A read-only live-state diagnostic from the source branch also produced exactly two route deletes and
six bounded updates, with zero creates, replacements, or Lambda-integration deletion. It is not a
deployable exact-main plan and changed no AWS resource.

## Remaining gate

SR-006 and D0-016 remain `In progress`. After the ordered rollback correction merges:

1. merge the ordered rollback correction and regenerate a fresh exact-main runtime baseline;
2. review, authorize, apply, and verify the route/trigger transition checksum;
3. independently review and authorize the one-integration-delete cleanup checksum;
4. pass final dark verification and direct-alias conformance;
5. separately plan and authorize restoration; and
6. repeat public authenticated, durable-workflow, isolation, queue/alarm/log, and zero-drift
   acceptance before cleanup.
