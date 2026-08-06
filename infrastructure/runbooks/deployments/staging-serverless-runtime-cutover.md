# Staging serverless runtime cutover

Use this runbook only for isolated synthetic staging after the gateway and workflow dark releases,
authenticated owner-isolation checks, release rollback/restoration, alarms, and zero drift have
been accepted. The cutover is one coupled transition: public API routing, new-event dispatch, the
SQS starter, the reconciler, and durable terminal recovery cannot be enabled independently.

This runbook does not authorize an AWS mutation. Planning produces an ignored saved plan and its
SHA-256. Apply only that exact plan after the product owner explicitly authorizes the printed
checksum.

## Preconditions

- Work from clean, upstream-matched `main` and the isolated staging AWS profile in `us-east-2`.
- Use the exact accepted immutable gateway and three workflow artifact identities, object versions,
  checksums, and pinned regional extension layer.
- Keep both retained ECS services at `0/0/0`; they are rollback resources and must not be deleted or
  restarted by the cutover plan.
- Drain the three legacy synthetic `temporal` outbox records through one bounded retained Temporal
  worker task. Stop that exact task afterward and prove every record terminal. Do not rewrite those
  records to `lambda_durable`. Follow the
  [staging legacy Temporal drain runbook](staging-legacy-temporal-drain.md).
- Prove a fresh zero-pending outbox, zero open Temporal and Lambda durable workflows, empty source
  queue/DLQs, all ten gateway/workflow alarms healthy, accepted aliases, and zero drift.

If any legacy work remains, stop. The guarded planner deliberately refuses to create a plan.

## Generate the exact plan

Inspect the command contract without changing AWS:

```powershell
.\scripts\plan-staging-serverless-runtime-cutover.ps1 -Help
```

Run the wrapper with the exact accepted artifact arguments. The wrapper delegates to the shared
planner with `Environment=staging` and `PlanRuntimeCutover=true`. Its fresh preflight performs one
bounded read-only outbox inspection task and a zero-open-Temporal query before Terraform can plan.

The accepted plan must contain exactly:

- Three creates: one API Gateway Lambda proxy integration and the two public `GET /health/live`
  and `GET /health/ready` routes.
- Six in-place updates: the default route, gateway function and alias, SQS starter mapping,
  reconciliation rule, and durable terminal rule.
- Zero deletes, replacements, ECS changes, persistent-data changes, secret changes, or legacy
  integration deletion.

The default route must use the exact JWT authorizer. Only the two health routes may use `NONE`.
The gateway's only functional configuration change is `OUTBOX_DISPATCH_TARGET=temporal` to
`lambda_durable`, published through a new immutable version and its existing staging alias. All
three workflow triggers must become enabled together.

Review the sanitized summary and the full local plan. Do not share the plan because Terraform
artifacts can contain sensitive infrastructure values. Authorization must quote its exact SHA-256.

Inspect the independently enforced apply boundary without changing AWS:

```powershell
.\scripts\operate-staging-serverless-runtime-cutover.ps1 -Help
```

Use `-Action Status` against the saved plan before requesting authorization. Apply requires the
exact staging account/state inputs, saved plan path, reviewed checksum, and `-Execute`. The operator
revalidates the three creates/six updates, rechecks zero legacy work, applies only the saved plan,
and immediately runs the completed-runtime zero-drift verifier. It never replans during apply.

## Apply and immediate acceptance

Apply only the retained reviewed plan; never regenerate a plan inside an apply command. Immediately
verify:

1. Public liveness and readiness return `200` through API Gateway and Lambda.
2. An unauthenticated protected request returns `401`; malformed or missing identity never reaches
   the application as an authenticated principal.
3. A real Auth0 user can read and save preferences, and a second user receives the same
   non-disclosing `404` isolation response already accepted in the dark boundary.
4. A newly created readiness operation reaches `succeeded` through SQS and the versioned durable
   workflow. An idempotent replay matches and creates no duplicate effective work.
5. The outbox, source queue, and DLQ return to zero; all replacement alarms remain `OK`; aggregate
   logs contain no credentials, tokens, candidate values, or cross-user identifiers.
6. ECS remains `0/0/0`, no Fargate application task or task public IP exists, and Temporal receives
   no new operation.
7. A refresh-backed plan with the same exact inputs reports zero drift.

Run the web conformance launcher with `-Environment staging -GatewayRuntime lambda-cutover`. This
mode requires the retained ECS service to stay idle, validates exactly one retained ECS integration
plus one Lambda proxy integration, enforces the two public health routes and JWT-protected default
route, checks durable triggers and dispatch, performs public `200/200/401`, and points the local BFF
directly at the deployed Lambda API. Complete authenticated persistence, cross-user isolation, and
the fixed synthetic workload before accepting the cutover.

Record plan/apply identifiers, checksum, immutable versions, aggregate test results, alarm/log
evidence, queue counts, and drift evidence without retaining candidate data or secret values.

## Post-cutover gateway releases

After cutover, never reuse the original dark gateway release planner. A gateway artifact update now
moves the public staging alias and is therefore a traffic-bearing change, even though API Gateway
routes remain unchanged. Publish a reviewed immutable gateway artifact first, then use
`plan-staging-serverless-runtime-cutover.ps1 -Action PlanGatewayRelease` with that artifact and the
three exact workflow artifacts already deployed.

The accepted plan must contain exactly two in-place updates: the gateway Lambda function and its
existing environment alias. It must contain zero creates, deletes, replacements, workflow-trigger
changes, ECS capacity changes, route/authorizer changes, data changes, or secret changes. The
gateway must retain `OUTBOX_DISPATCH_TARGET=lambda_durable`; only `RELEASE_SHA` may change in its
environment. The planner verifies all four versioned, KMS-encrypted S3 artifacts before producing
the ignored saved plan and reports `ApiTrafficChange=true`.

Inspect the independently enforced operator boundary without changing AWS:

```powershell
.\scripts\operate-staging-gateway-runtime-release.ps1 -Help
```

Run `-Action Status` against the saved plan, review its local sensitive contents, and authorize the
exact SHA-256. `-Action Apply` requires that checksum, the isolated staging account/state inputs,
and `-Execute`. It applies only the saved plan from clean upstream-matched `main`, then runs the
completed-runtime verifier and requires zero drift. Finally, rerun the `lambda-cutover` web
conformance: public `200/200/401`, authenticated preference load/save, cross-user isolation, one
durable readiness operation, clean queues/DLQs, healthy alarms, idle ECS, and no new Temporal work.
Rollback to a prior gateway build is the same process using that prior immutable artifact; it is a
new separately reviewed two-update plan, never an unversioned code overwrite.

## JWT route-scope boundary

The protected `$default` route requires `profile:read` and `profile:write` as its accepted OAuth
scope set. API Gateway permits a token containing at least one configured scope, passes the
validated scope list to Lambda, and Lambda continues to require `profile:read` for reads and
`profile:write` for writes. Public health routes remain anonymous and outside this default route.

Use `plan-staging-serverless-runtime-cutover.ps1 -Action PlanScopeBoundary` only when live state
lacks this exact set. The plan must contain one in-place update to the default route's
`authorization_scopes` and zero other actions. Review it through
`operate-staging-gateway-runtime-release.ps1 -Action Status`, authorize its exact checksum, and
apply it through the same operator. Completed-runtime verification must return zero drift before
authenticated preference load/save, cross-user isolation, and durable readiness are repeated.

## Encrypted outbox producer recovery

If preference persistence succeeds but its readiness operation remains `queued`, inspect the
privacy-safe gateway and reconciler outcomes before replaying or changing product data. A failed
post-commit SQS nudge does not mean the preference transaction was lost: PostgreSQL commits the
preference, operation, and identifier-only outbox row atomically, and the scheduled reconciler
retains a bounded retry.

For a platform-CMK-encrypted SQS queue, [AWS requires producers](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-key-management.html)
to have `kms:Decrypt` and `kms:GenerateDataKey` on that exact key in addition to
`sqs:SendMessage` on the exact queue. The starter is a consumer and retains `kms:Decrypt` only. Use
`plan-staging-serverless-runtime-cutover.ps1 -Action PlanOutboxProducerKms` to generate the repair.
The accepted plan must contain exactly two in-place updates—the gateway and reconciler inline role
policies—and zero creates, deletes, replacements, key/queue changes, traffic changes, trigger
changes, function changes, data changes, secret changes, or ECS capacity changes.

Review the saved plan through `operate-staging-gateway-runtime-release.ps1 -Action Status`, then
authorize and apply only its exact SHA-256. The operator selects the matching
`VerifyOutboxProducerKms` zero-drift mode. Allow the existing bounded reconciler retry to recover
the queued outbox row; do not create a replacement preference operation merely to force progress.
Acceptance requires the original owner-visible operation to reach `succeeded`, the source queue
and DLQs to return to zero, clean aggregate logs, healthy alarms, and a subsequent normal save to
complete once without duplicate effective work.

## Rollback boundary

Rollback is another reviewed coupled plan. Do not use the original cutover plan after any accepted
gateway, authentication, scope, permission, or workflow maintenance release: its variables describe
the old runtime and could reconstruct superseded artifacts or policy. From clean, upstream-matched
current `main`, first run `plan-staging-serverless-runtime-cutover.ps1 -Action Verify` with the exact
currently deployed artifact inputs. Retain its ignored
`serverless-runtime-cutover-verify-<commit>.tfplan`; it must be a refresh-backed zero-change plan.
The rollback operator independently validates that baseline's Lambda API, exact JWT scopes, durable
dispatch, enabled triggers, idle ECS services, and zero drift, and binds the entire rollback/restore
context to its path, checksum, commit, account, and state boundary.

Before generating rollback, stop new writes and require every outbox record, source queue, both
DLQs, durable execution, and Temporal workflow to be terminal. Rollback is deliberately split into
two checksum-reviewed applies because API Gateway can continue reporting an integration as in use
while an in-place route update propagates.

1. Run `PlanRollback` against the fresh runtime baseline with `-ConfirmZeroTraffic`. Its exact
   transition contains two public-health-route deletes and six bounded route/gateway/trigger
   updates. It sets `serverless_runtime_cutover=false` and
   `retain_gateway_lambda_integration_during_rollback=true`; therefore it cannot delete the Lambda
   integration. Review its checksum before `ApplyRollback`.
2. `ApplyRollback` records an applied state before verification, then requires a refresh-backed
   zero-change plan proving the default route points to retained ECS, JWT/public Lambda routes are
   absent, dispatch is `temporal`, every replacement trigger is disabled, ECS remains `0/0/0`, and
   the Lambda integration exists but is unreferenced. If execution is interrupted after Terraform,
   run `VerifyRollbackTransition -ConfirmZeroTraffic` to recover that state without reapplying.
3. Run `PlanRollbackCleanup -ConfirmZeroTraffic`. It independently repeats the retained-integration
   zero-drift and zero-work checks, then produces exactly one delete: the unreferenced Lambda
   integration. Review this second checksum before `ApplyRollbackCleanup`.
4. `ApplyRollbackCleanup` applies only that one-delete plan and runs the complete dark verifier.
   If its post-apply verification is interrupted, `VerifyRollback` recovers the verified final
   rollback state without replaying the deletion.

Neither step deletes Lambda functions, queues, database, API, Cloud Map, ECS, or Temporal resources,
and neither changes ECS capacity. Because both ECS services deliberately remain `0/0/0`, the public
API is unavailable throughout this zero-traffic drill. After `VerifyRollback`, perform the accepted
direct-alias dark conformance.

If a required drain/operator/evidence correction merges after rollback verification, do not edit
the ignored context or rename/copy its retained runtime baseline. Run `ContinueRollbackContext`
from clean synchronized `main`, with the exact retained baseline path, account/state boundary, and
`-ConfirmRollbackConformance`. It accepts only a verified rollback context, requires the baseline
source commit to remain an ancestor of current `main`, reproves the current dark runtime at zero
drift, requires zero legacy/serverless work, and updates only the context's validated operator
commit. It performs no AWS mutation. Any divergent history, changed live boundary, nonempty work,
or unverified rollback fails closed.

Only after that passes, use
`PlanRestore -ConfirmRollbackConformance`, review the new restoration checksum, and run
`ApplyRestore`. Repeat `lambda-cutover` public/authenticated/workload acceptance, then use
`Cleanup -ConfirmRestoreConformance -Execute` to remove only ignored local plans/context. Resuming
ECS is a separate explicit capacity plan and is not part of this cost-preserving drill.
Legacy-resource deletion and Temporal credential revocation remain later, separately reviewed work
after the acceptance window expires.

Restoration verification creates a fresh current-commit runtime baseline and records its path in
the context and sanitized result. Use that returned baseline path for the later cleanup command;
the historical pre-rollback baseline remains immutable evidence and is never relabeled as current.
