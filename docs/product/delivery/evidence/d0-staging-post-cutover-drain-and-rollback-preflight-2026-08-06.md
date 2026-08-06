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

## Remaining gate

SR-006 and D0-016 remain `In progress`. After this correction merges:

1. regenerate the rollback plan from clean exact `main` and the fresh runtime baseline;
2. review and separately authorize its checksum;
3. apply the deliberate zero-traffic rollback, which temporarily makes the public API unavailable
   because retained ECS capacity stays at zero;
4. pass direct-alias dark conformance;
5. separately plan and authorize restoration; and
6. repeat public authenticated, durable-workflow, isolation, queue/alarm/log, and zero-drift
   acceptance before cleanup.
