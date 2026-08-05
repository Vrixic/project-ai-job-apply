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

## Rollback boundary

Rollback is another reviewed coupled plan. Before generating it, stop new writes and require every
outbox record, source queue, both DLQs, durable execution, and Temporal workflow to be terminal. Use
`PlanRollback` with `-ConfirmZeroTraffic`; review its separate checksum before `ApplyRollback`.
The exact rollback deletes only the Lambda integration and two public health routes and performs
six bounded updates that disable all replacement triggers, restore Temporal dispatch, and point
the default route at retained ECS. It never deletes Lambda, queues, database, API, Cloud Map, ECS,
or Temporal resources and never changes ECS capacity.

Because both ECS services deliberately remain `0/0/0`, the public API is unavailable during this
zero-traffic rollback drill. Run `VerifyRollback`, then perform the accepted direct-alias dark
conformance. Only after that passes, use `PlanRestore -ConfirmRollbackConformance`, review the new
restoration checksum, and run `ApplyRestore`. Repeat `lambda-cutover` public/authenticated/workload
acceptance, then use `Cleanup -ConfirmRestoreConformance -Execute` to remove only ignored local
plans/context. Resuming ECS would be a separate explicit capacity plan and is not part of this
cost-preserving drill. Legacy-resource deletion and Temporal credential revocation remain later,
separately reviewed work after the acceptance window expires.
