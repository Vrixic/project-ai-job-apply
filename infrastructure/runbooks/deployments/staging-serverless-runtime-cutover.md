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
  records to `lambda_durable`.
- Prove a fresh zero-pending outbox, zero open Temporal workflows, empty SQS/DLQ, seven healthy
  replacement alarms, accepted aliases, and zero drift.

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

Record plan/apply identifiers, checksum, immutable versions, aggregate test results, alarm/log
evidence, queue counts, and drift evidence without retaining candidate data or secret values.

## Rollback boundary

Rollback is another reviewed atomic plan. It must route the API default back to the retained ECS
integration, disable all three replacement triggers, and restore gateway dispatch to `temporal`
together. Never run both starters for the same outbox target.

Before rollback, stop new writes and reconcile every event created after cutover to a known terminal
state. Resume the retained gateway and worker services only through the Terraform-owned rollback
procedure, then prove health and task networking. The legacy resources remain until the acceptance
window expires; deletion and Temporal credential revocation are later, separately reviewed work.
